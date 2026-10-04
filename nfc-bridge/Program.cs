using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace FleetFlow.NfcBridge;

internal sealed record NfcEvent(long Sequence, string Uid, string Reader, DateTimeOffset ReadAt);
internal sealed record BridgeConfig(string[]? AllowedOrigins);

internal static class Program
{
    private const int Port = 17831;
    private static readonly object StateLock = new();
    private static readonly HashSet<string> PresentReaders = new(StringComparer.Ordinal);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly HashSet<string> AllowedOrigins = LoadAllowedOrigins();
    private static string[] Readers = [];
    private static NfcEvent? LatestEvent;
    private static long Sequence;

    public static async Task Main()
    {
        using var cancellation = new CancellationTokenSource();
        Console.CancelKeyPress += (_, args) => { args.Cancel = true; cancellation.Cancel(); };
        Console.WriteLine("FleetFlow NFC Bridge 1.0.0");
        Console.WriteLine("RC-S300 / RC-S380 を待機しています。");
        Console.WriteLine($"ブラウザー連携: http://127.0.0.1:{Port}");

        var readerTask = Task.Run(() => PollReaders(cancellation.Token), cancellation.Token);
        var serverTask = RunServer(cancellation.Token);
        await Task.WhenAll(readerTask, serverTask);
    }

    private static HashSet<string> LoadAllowedOrigins()
    {
        var defaults = new[] { "http://localhost:3035", "http://127.0.0.1:3035", "http://localhost:3000", "http://127.0.0.1:3000" };
        var configured = Environment.GetEnvironmentVariable("FLEETFLOW_ALLOWED_ORIGINS");
        var configPath = Path.Combine(AppContext.BaseDirectory, "bridge.json");
        if (string.IsNullOrWhiteSpace(configured) && File.Exists(configPath))
        {
            try { configured = string.Join(';', JsonSerializer.Deserialize<BridgeConfig>(File.ReadAllText(configPath), JsonOptions)?.AllowedOrigins ?? []); }
            catch (Exception error) { Console.Error.WriteLine($"bridge.jsonを読み込めません: {error.Message}"); }
        }
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
                lock (StateLock) { readers = Readers; sequence = Sequence; }
                await WriteResponse(stream, 200, new { status = "ok", readerConnected = readers.Length > 0, readers, sequence, version = "1.0.0" }, origin);
                return;
            }
            if (uri.AbsolutePath == "/events")
            {
                var afterText = uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
                    .Select(part => part.Split('=', 2))
                    .FirstOrDefault(part => part.Length == 2 && part[0] == "after")?
                    .ElementAtOrDefault(1);
                _ = long.TryParse(afterText, out var after);
                NfcEvent? latest;
                long sequence;
                bool readerConnected;
                lock (StateLock) { latest = LatestEvent; sequence = Sequence; readerConnected = Readers.Length > 0; }
                await WriteResponse(stream, 200, new { sequence, readerConnected, @event = latest?.Sequence > after ? latest : null }, origin);
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
                var readers = WinSCard.ListReaders(context);
                lock (StateLock) Readers = readers;
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
                LatestEvent = new NfcEvent(Sequence, uid, reader, DateTimeOffset.Now);
            }
            Console.WriteLine($"{DateTime.Now:HH:mm:ss} UID {uid} ({reader})");
        }
        finally { WinSCard.SCardDisconnect(card, WinSCard.LeaveCard); }
    }
}

internal static class WinSCard
{
    public const int Success = 0;
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

    public static string[] ListReaders(nint context)
    {
        uint length = 0;
        if (SCardListReaders(context, null, null, ref length) != Success || length <= 1) return [];
        var buffer = new StringBuilder((int)length);
        if (SCardListReaders(context, null, buffer, ref length) != Success) return [];
        return buffer.ToString().Split('\0', StringSplitOptions.RemoveEmptyEntries);
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
