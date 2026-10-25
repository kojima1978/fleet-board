using System.Net;
using System.Net.Sockets;
using System.IO.Ports;
using Microsoft.Win32;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using System.Text.Json;

namespace FleetFlow.NfcBridge;

internal sealed record ScanEvent(long Sequence, string Kind, string Value, string Reader, DateTimeOffset ReadAt);
internal sealed record BridgeConfig(string[]? AllowedOrigins, string? QrComPort, int? QrBaudRate);

[SupportedOSPlatform("windows")]
internal static class Program
{
    private const int Port = 17831;
    private const string BridgeVersion = "1.2.1";
    private static readonly object StateLock = new();
    private static readonly HashSet<string> PresentReaders = new(StringComparer.Ordinal);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly HashSet<string> AllowedOrigins = LoadAllowedOrigins();
    private static readonly BridgeConfig Config = LoadConfig();
    private static string[] Readers = [];
    private static ScanEvent? LatestEvent;
    private static bool QrReaderConnected;
    private static string? QrPort;
    private static bool QrDeviceKnown = !string.IsNullOrWhiteSpace(Config.QrComPort);
    private static string? LastQrValue;
    private static DateTimeOffset LastQrReadAt;
    private static long Sequence;

    public static async Task Main()
    {
        using var cancellation = new CancellationTokenSource();
        Console.CancelKeyPress += (_, args) => { args.Cancel = true; cancellation.Cancel(); };
        Console.WriteLine($"FleetFlow NFC・QR Bridge {BridgeVersion}");
        Console.WriteLine("RC-S300 / RC-S380 を待機しています。");
        Console.WriteLine(Config.QrComPort is null ? "QRスキャナを自動検出します。" : $"QRスキャナを待機しています（優先ポート: {Config.QrComPort}）。");
        Console.WriteLine($"ブラウザー連携: http://127.0.0.1:{Port}");

        var readerTask = Task.Run(() => PollReaders(cancellation.Token), cancellation.Token);
        var qrTask = Task.Run(() => PollQrReader(cancellation.Token), cancellation.Token);
        var serverTask = RunServer(cancellation.Token);
        await Task.WhenAll(readerTask, qrTask, serverTask);
    }

    private static BridgeConfig LoadConfig()
    {
        var configPath = Path.Combine(AppContext.BaseDirectory, "bridge.json");
        if (!File.Exists(configPath)) return new BridgeConfig(null, null, null);
        try { return JsonSerializer.Deserialize<BridgeConfig>(File.ReadAllText(configPath), JsonOptions) ?? new BridgeConfig(null, null, null); }
        catch (Exception error) { Console.Error.WriteLine($"bridge.jsonを読み込めません: {error.Message}"); return new BridgeConfig(null, null, null); }
    }

    private static HashSet<string> LoadAllowedOrigins()
    {
        var defaults = new[] { "http://localhost:3035", "http://127.0.0.1:3035", "http://localhost:3000", "http://127.0.0.1:3000" };
        var configured = Environment.GetEnvironmentVariable("FLEETFLOW_ALLOWED_ORIGINS");
        if (string.IsNullOrWhiteSpace(configured)) configured = string.Join(';', LoadConfig().AllowedOrigins ?? []);
        var values = string.IsNullOrWhiteSpace(configured) ? defaults : configured.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return new HashSet<string>(values.Select(value => value.TrimEnd('/')), StringComparer.OrdinalIgnoreCase);
    }

    private static async Task RunServer(CancellationToken token)
    {
        var listener = new TcpListener(IPAddress.Loopback, Port);
        listener.Start();
        try
        {
            while (!token.IsCancellationRequested)
            {
                var client = await listener.AcceptTcpClientAsync(token);
                _ = Task.Run(() => HandleClient(client), token);
            }
        }
        catch (OperationCanceledException) { }
        finally { listener.Stop(); }
    }

    private static async Task HandleClient(TcpClient client)
    {
        using (client)
        using (var stream = client.GetStream())
        using (var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true))
        {
            var requestLine = await reader.ReadLineAsync();
            if (string.IsNullOrWhiteSpace(requestLine)) return;
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            string? line;
            while (!string.IsNullOrEmpty(line = await reader.ReadLineAsync()))
            {
                var separator = line.IndexOf(':');
                if (separator > 0) headers[line[..separator].Trim()] = line[(separator + 1)..].Trim();
            }

            var parts = requestLine.Split(' ');
            if (parts.Length < 2) return;
            var method = parts[0];
            var uri = new Uri($"http://127.0.0.1{parts[1]}");
            headers.TryGetValue("Origin", out var origin);
            var originAllowed = string.IsNullOrWhiteSpace(origin) || AllowedOrigins.Contains(origin.TrimEnd('/'));
            if (!originAllowed) { await WriteResponse(stream, 403, new { message = "このWebアプリからの接続は許可されていません" }, null); return; }
            if (method == "OPTIONS") { await WriteResponse(stream, 204, null, origin); return; }
            if (method != "GET") { await WriteResponse(stream, 405, new { message = "GETのみ利用できます" }, origin); return; }

            if (uri.AbsolutePath == "/health")
            {
                string[] readers;
                long sequence;
                bool qrReaderConnected;
                string? qrPort;
                lock (StateLock) { readers = Readers; sequence = Sequence; qrReaderConnected = QrReaderConnected; qrPort = QrPort; }
                bool qrConfigured;
                lock (StateLock) qrConfigured = QrDeviceKnown;
                await WriteResponse(stream, 200, new { status = "ok", readerConnected = readers.Length > 0, readers, qrReaderConnected, qrConfigured, qrPort, sequence, version = BridgeVersion }, origin);
                return;
            }
            if (uri.AbsolutePath == "/events")
            {
                var afterText = uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
                    .Select(part => part.Split('=', 2))
                    .FirstOrDefault(part => part.Length == 2 && part[0] == "after")?
                    .ElementAtOrDefault(1);
                _ = long.TryParse(afterText, out var after);
                ScanEvent? latest;
                long sequence;
                bool readerConnected;
                bool qrReaderConnected;
                bool qrConfigured;
                lock (StateLock) { latest = LatestEvent; sequence = Sequence; readerConnected = Readers.Length > 0; qrReaderConnected = QrReaderConnected; qrConfigured = QrDeviceKnown; }
                await WriteResponse(stream, 200, new { sequence, readerConnected, qrReaderConnected, qrConfigured, @event = latest?.Sequence > after ? latest : null }, origin);
                return;
            }
            await WriteResponse(stream, 404, new { message = "Not found" }, origin);
        }
    }

    private static async Task WriteResponse(NetworkStream stream, int status, object? body, string? origin)
    {
        var payload = body is null ? [] : JsonSerializer.SerializeToUtf8Bytes(body, JsonOptions);
        var reason = status switch { 200 => "OK", 204 => "No Content", 403 => "Forbidden", 404 => "Not Found", 405 => "Method Not Allowed", _ => "Error" };
        var headers = new StringBuilder($"HTTP/1.1 {status} {reason}\r\nConnection: close\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {payload.Length}\r\nCache-Control: no-store\r\n");
        if (!string.IsNullOrWhiteSpace(origin)) headers.Append($"Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\n");
        headers.Append("\r\n");
        await stream.WriteAsync(Encoding.ASCII.GetBytes(headers.ToString()));
        if (payload.Length > 0) await stream.WriteAsync(payload);
    }

    private static async Task PollReaders(CancellationToken token)
    {
        nint context = 0;
        while (!token.IsCancellationRequested)
        {
            try
            {
                if (context == 0 && WinSCard.SCardEstablishContext(WinSCard.ScopeSystem, 0, 0, out context) != WinSCard.Success)
                {
                    await Task.Delay(1500, token); continue;
                }
                var listResult = WinSCard.ListReaders(context, out var readers);
                if (listResult != WinSCard.Success && listResult != WinSCard.NoReadersAvailable)
                    throw new InvalidOperationException($"リーダー一覧を取得できません（0x{unchecked((uint)listResult):X8}）");
                lock (StateLock) Readers = readers;
                // USBを抜くとWindows側のPC/SCコンテキストが古い状態を保持することがある。
                // リーダーが0台になった時点で破棄し、次の周回で作り直すことで再挿入を確実に検出する。
                if (readers.Length == 0)
                {
                    lock (StateLock) PresentReaders.Clear();
                    WinSCard.SCardReleaseContext(context);
                    context = 0;
                    await Task.Delay(750, token);
                    continue;
                }
                foreach (var reader in readers) ReadCard(context, reader);
                lock (StateLock) PresentReaders.RemoveWhere(reader => !readers.Contains(reader, StringComparer.Ordinal));
                await Task.Delay(300, token);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception error)
            {
                Console.Error.WriteLine($"NFC読取エラー: {error.Message}");
                if (context != 0) WinSCard.SCardReleaseContext(context);
                context = 0;
                lock (StateLock) { Readers = []; PresentReaders.Clear(); }
                await Task.Delay(1500, token);
            }
        }
        if (context != 0) WinSCard.SCardReleaseContext(context);
    }

    private static void ReadCard(nint context, string reader)
    {
        var result = WinSCard.SCardConnect(context, reader, WinSCard.ShareShared, WinSCard.ProtocolT0 | WinSCard.ProtocolT1, out var card, out var protocol);
        if (result != WinSCard.Success)
        {
            lock (StateLock) PresentReaders.Remove(reader);
            return;
        }
        try
        {
            lock (StateLock) if (PresentReaders.Contains(reader)) return;
            var uid = WinSCard.ReadUid(card, protocol);
            if (string.IsNullOrWhiteSpace(uid)) return;
            lock (StateLock)
            {
                PresentReaders.Add(reader);
                Sequence++;
                LatestEvent = new ScanEvent(Sequence, "nfc", uid, reader, DateTimeOffset.Now);
            }
            Console.WriteLine($"{DateTime.Now:HH:mm:ss} UID {uid} ({reader})");
        }
        finally { WinSCard.SCardDisconnect(card, WinSCard.LeaveCard); }
    }

    private static async Task PollQrReader(CancellationToken token)
    {
        var baudRate = Config.QrBaudRate is > 0 ? Config.QrBaudRate.Value : 9600;
        string? lastWaitingReason = null;
        while (!token.IsCancellationRequested)
        {
            var resolution = ResolveQrPort();
            if (resolution.Port is null)
            {
                if (resolution.Reason != lastWaitingReason) Console.WriteLine(resolution.Reason);
                lastWaitingReason = resolution.Reason;
                try { await Task.Delay(1500, token); } catch (OperationCanceledException) { break; }
                continue;
            }
            var portName = resolution.Port;
            lastWaitingReason = null;
            try
            {
                using var port = new SerialPort(portName, baudRate, Parity.None, 8, StopBits.One) { ReadTimeout = 500, NewLine = "\r" };
                port.Open();
                lock (StateLock) { QrReaderConnected = true; QrPort = portName; }
                Console.WriteLine($"QRスキャナ接続: {portName}");
                var buffer = new StringBuilder();
                while (!token.IsCancellationRequested && port.IsOpen)
                {
                    try
                    {
                        var next = port.ReadChar();
                        if (next is '\r' or '\n' or 0x03)
                        {
                            var value = buffer.ToString().Trim();
                            buffer.Clear();
                            if (value.Length > 0) PublishQr(value, portName);
                        }
                        else if (next >= 0x20 && buffer.Length < 512) buffer.Append((char)next);
                    }
                    catch (TimeoutException) { }
                }
            }
            catch (OperationCanceledException) { break; }
            catch (Exception error)
            {
                Console.Error.WriteLine($"QR読取エラー（{portName}）: {error.Message}");
            }
            finally { lock (StateLock) { QrReaderConnected = false; QrPort = null; } }
            try { await Task.Delay(1500, token); } catch (OperationCanceledException) { break; }
        }
    }

    private static (string? Port, string Reason) ResolveQrPort()
    {
        string[] available;
        try { available = SerialPort.GetPortNames().Select(port => port.ToUpperInvariant()).ToArray(); }
        catch (Exception error) { return (null, $"COMポートを確認できません: {error.Message}"); }

        var configured = Config.QrComPort?.Trim().ToUpperInvariant();
        if (!string.IsNullOrWhiteSpace(configured) && available.Contains(configured, StringComparer.OrdinalIgnoreCase))
            return (configured, string.Empty);

        var detected = FindDensoQrPorts(available);
        if (detected.Length == 1)
        {
            lock (StateLock) QrDeviceKnown = true;
            if (!string.IsNullOrWhiteSpace(configured) && !string.Equals(configured, detected[0], StringComparison.OrdinalIgnoreCase))
                Console.WriteLine($"QRスキャナのポート変更を検出: {configured} → {detected[0]}");
            return (detected[0], string.Empty);
        }
        if (detected.Length > 1)
            return (null, $"QK30-Uが複数見つかりました（{string.Join(", ", detected)}）。bridge.jsonで使用するCOMポートを指定してください。");
        return (null, string.IsNullOrWhiteSpace(configured)
            ? "QRスキャナを待機しています（QK30-UをUSBへ接続してください）。"
            : $"QRスキャナを待機しています（{configured}または自動検出したQK30-U）。");
    }

    private static string[] FindDensoQrPorts(string[] availablePorts)
    {
        const string deviceKeyPath = @"SYSTEM\CurrentControlSet\Enum\USB\VID_076D&PID_0006";
        var results = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var deviceKey = Registry.LocalMachine.OpenSubKey(deviceKeyPath);
            if (deviceKey is null) return [];
            foreach (var instanceName in deviceKey.GetSubKeyNames())
            {
                using var parameters = deviceKey.OpenSubKey($@"{instanceName}\Device Parameters");
                var portName = parameters?.GetValue("PortName") as string;
                if (!string.IsNullOrWhiteSpace(portName) && availablePorts.Contains(portName, StringComparer.OrdinalIgnoreCase))
                    results.Add(portName.ToUpperInvariant());
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"QK30-U自動検出エラー: {error.Message}");
        }
        return results.OrderBy(port => port, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static void PublishQr(string value, string portName)
    {
        lock (StateLock)
        {
            // トリガーを長押ししたときの連続デコードで、同じ利用・返却操作を二重に開かない。
            var now = DateTimeOffset.Now;
            if (value == LastQrValue && now - LastQrReadAt < TimeSpan.FromSeconds(2)) return;
            LastQrValue = value;
            LastQrReadAt = now;
            Sequence++;
            LatestEvent = new ScanEvent(Sequence, "qr", value, portName, now);
        }
        // QR値は社員・車両を識別する固定トークンを含むため、運用ログへ平文で残さない。
        Console.WriteLine($"{DateTime.Now:HH:mm:ss} QR読取 ({portName})");
    }
}

internal static class WinSCard
{
    public const int Success = 0;
    public const int NoReadersAvailable = unchecked((int)0x8010002E);
    public const uint ScopeSystem = 2;
    public const uint ShareShared = 2;
    public const uint ProtocolT0 = 1;
    public const uint ProtocolT1 = 2;
    public const uint LeaveCard = 0;

    [StructLayout(LayoutKind.Sequential)]
    private struct IoRequest { public uint Protocol; public uint PciLength; }

    [DllImport("winscard.dll")]
    public static extern int SCardEstablishContext(uint scope, nint reserved1, nint reserved2, out nint context);
    [DllImport("winscard.dll")]
    public static extern int SCardReleaseContext(nint context);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode, EntryPoint = "SCardListReadersW")]
    private static extern int SCardListReaders(nint context, string? groups, StringBuilder? readers, ref uint readersLength);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode, EntryPoint = "SCardConnectW")]
    public static extern int SCardConnect(nint context, string reader, uint shareMode, uint preferredProtocols, out nint card, out uint activeProtocol);
    [DllImport("winscard.dll")]
    public static extern int SCardDisconnect(nint card, uint disposition);
    [DllImport("winscard.dll")]
    private static extern int SCardTransmit(nint card, ref IoRequest sendPci, byte[] sendBuffer, uint sendLength, nint receivePci, byte[] receiveBuffer, ref uint receiveLength);

    public static int ListReaders(nint context, out string[] readers)
    {
        readers = [];
        uint length = 0;
        var result = SCardListReaders(context, null, null, ref length);
        if (result != Success || length <= 1) return result;
        var buffer = new StringBuilder((int)length);
        result = SCardListReaders(context, null, buffer, ref length);
        if (result != Success) return result;
        readers = buffer.ToString().Split('\0', StringSplitOptions.RemoveEmptyEntries);
        return Success;
    }

    public static string? ReadUid(nint card, uint protocol)
    {
        var command = new byte[] { 0xFF, 0xCA, 0x00, 0x00, 0x00 };
        var response = new byte[258];
        uint responseLength = (uint)response.Length;
        var pci = new IoRequest { Protocol = protocol, PciLength = (uint)Marshal.SizeOf<IoRequest>() };
        if (SCardTransmit(card, ref pci, command, (uint)command.Length, 0, response, ref responseLength) != Success || responseLength < 3) return null;
        if (response[responseLength - 2] != 0x90 || response[responseLength - 1] != 0x00) return null;
        return Convert.ToHexString(response.AsSpan(0, (int)responseLength - 2));
    }
}
