using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;

namespace FleetFlow.Setup;

internal static class Program
{
    [STAThread]
    private static int Main(string[] arguments)
    {
        // 配布物の検証専用。導入・レジストリ変更・画面表示は一切しない。
        if (arguments.SequenceEqual(new[] { "--verify-only" }))
        {
            try
            {
                _ = SetupForm.ReadApplicationUrl();
                var names = Assembly.GetExecutingAssembly().GetManifestResourceNames();
                foreach (var file in new[] { "FleetFlow.NfcBridge.exe", "install.ps1", "uninstall.ps1", "launch.ps1", "start-fleetflow.ps1", "messages.ja.json", "FleetFlow NFC-QR Restart.cmd", "FleetFlow NFC-QR Uninstall.cmd" })
                    if (!names.Contains("Payload." + file)) return 2;
                return 0;
            }
            catch { return 1; }
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new SetupForm());
        return 0;
    }
}

internal sealed class SetupForm : Form
{
    private readonly Label status = new() { Dock = DockStyle.Fill, Padding = new Padding(24), Text = "FleetFlow連携ソフトを準備しています…\nこの画面は完了まで閉じないでください。" };
    public SetupForm()
    {
        Text = "FleetFlow NFC・QR セットアップ";
        ClientSize = new Size(540, 180);
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        ControlBox = false;
        Controls.Add(status);
        Shown += async (_, _) => await InstallAsync();
    }

    internal static Uri ReadApplicationUrl()
    {
        // 配布バイナリは共通。接続先だけをダウンロード名から取得する（コマンドには埋め込まない）。
        var name = Path.GetFileName(Environment.ProcessPath ?? "");
        var match = Regex.Match(name, @"^FleetFlow-Setup-([A-Za-z0-9_-]+)(?: \(\d+\))?\.exe$", RegexOptions.IgnoreCase);
        if (!match.Success) throw new InvalidOperationException("ダウンロードしたファイルの名前が変更されています。FleetFlowの画面からもう一度ダウンロードしてください。");
        var encoded = match.Groups[1].Value.Replace('-', '+').Replace('_', '/');
        encoded = encoded.PadRight((encoded.Length + 3) / 4 * 4, '=');
        var value = Encoding.UTF8.GetString(Convert.FromBase64String(encoded));
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            (uri.Scheme != "http" && uri.Scheme != "https") ||
            !string.IsNullOrEmpty(uri.UserInfo) || uri.AbsolutePath != "/" ||
            !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
            throw new InvalidOperationException("接続先URLが正しくありません。FleetFlowから再ダウンロードしてください。");
        return uri;
    }

    private async Task InstallAsync()
    {
        string? temporary = null;
        try
        {
            var appUrl = ReadApplicationUrl();
            status.Text = $"接続先：{appUrl.GetLeftPart(UriPartial.Authority)}\n\n連携ソフトを導入しています…\n管理者権限・Docker・URL入力は不要です。";
            temporary = Path.Combine(Path.GetTempPath(), "fleetflow-setup-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(temporary, "dist"));
            var assembly = Assembly.GetExecutingAssembly();
            foreach (var resource in assembly.GetManifestResourceNames().Where(name => name.StartsWith("Payload.", StringComparison.Ordinal)))
            {
                var file = resource["Payload.".Length..];
                var destination = file == "FleetFlow.NfcBridge.exe" ? Path.Combine(temporary, "dist", file) : Path.Combine(temporary, file);
                using var input = assembly.GetManifestResourceStream(resource)!;
                using var output = File.Create(destination);
                await input.CopyToAsync(output);
            }
            var start = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            foreach (var argument in new[] { "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", Path.Combine(temporary, "install.ps1"), "-AllowedOrigins", appUrl.GetLeftPart(UriPartial.Authority) + ";http://localhost:3035;http://127.0.0.1:3035", "-KeepExistingConfiguration" }) start.ArgumentList.Add(argument);
            using var process = Process.Start(start) ?? throw new InvalidOperationException("セットアップを開始できませんでした。");
            var outputTask = process.StandardOutput.ReadToEndAsync();
            var errorTask = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();
            var outputText = await outputTask;
            var errorText = await errorTask;
            if (process.ExitCode != 0) throw new InvalidOperationException($"連携ソフトを導入できませんでした。\n{errorText}");
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            var connected = false;
            for (var attempt = 0; attempt < 20; attempt++)
            {
                try
                {
                    using var response = await client.GetAsync("http://127.0.0.1:17831/health");
                    if (response.IsSuccessStatusCode) { connected = true; break; }
                }
                catch (HttpRequestException) { }
                catch (TaskCanceledException) { }
                await Task.Delay(500);
            }
            status.Text = connected
                ? "導入・起動が完了しました。\nFleetFlowの画面へ戻ってください。数秒で接続状態が更新されます。\n障害時の操作方法はFleetFlow画面の接続案内で確認できます。"
                : "導入は完了しましたが、連携ソフトの起動を確認できませんでした。\nFleetFlowの「設定 → NFC・QR」で接続状態を確認し、必要に応じて管理フォルダーの再起動・再接続CMDを実行してください。";
        }
        catch (Exception error)
        {
            status.Text = "セットアップを完了できませんでした。\n" + error.Message;
        }
        finally
        {
            ControlBox = true;
            // 自分で作成した一意な一時ディレクトリのみ削除する。
            if (temporary is not null)
            {
                try { Directory.Delete(temporary, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
            var close = new Button { Text = "閉じる", Dock = DockStyle.Bottom, Height = 38 };
            close.Click += (_, _) => Close();
            Controls.Add(close);
        }
    }
}
