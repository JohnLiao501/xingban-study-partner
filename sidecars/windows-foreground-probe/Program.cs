using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace Xingban.ForegroundProbe;

public record ForegroundSamplePayload(
    [property: JsonPropertyName("capturedAt")] string CapturedAt,
    [property: JsonPropertyName("processName")] string ProcessName,
    [property: JsonPropertyName("windowTitle")] string WindowTitle,
    [property: JsonPropertyName("pid")] int Pid
);

[JsonSourceGenerationOptions(WriteIndented = false)]
[JsonSerializable(typeof(ForegroundSamplePayload))]
internal partial class ProbeJsonContext : JsonSerializerContext
{
}

public static class Program
{
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("kernel32.dll")]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref uint lpdwSize);

    public static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;

        int intervalMs = 5000;
        bool onceMode = false;

        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--interval" && i + 1 < args.Length && int.TryParse(args[i + 1], out int parsed))
            {
                intervalMs = Math.Max(500, parsed);
                i++;
            }
            else if (args[i] == "--once")
            {
                onceMode = true;
            }
        }

        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
        };

        // 监听 stdin 管道关闭（如果父进程 Electron 退出，stdin 自动 EOF）
        _ = Task.Run(() =>
        {
            try
            {
                while (Console.In.Read() != -1)
                {
                    // 忽略标准输入内容
                }
                cts.Cancel();
            }
            catch
            {
                cts.Cancel();
            }
        });

        while (!cts.IsCancellationRequested)
        {
            try
            {
                var sample = CaptureForeground();
                if (sample != null)
                {
                    string json = JsonSerializer.Serialize(sample, ProbeJsonContext.Default.ForegroundSamplePayload);
                    Console.WriteLine(json);
                    Console.Out.Flush();
                }
            }
            catch (Exception ex)
            {
                // stderr 只输出内部错误标识，绝不打印窗口标题等敏感数据
                Console.Error.WriteLine($"PROBE_CAPTURE_ERROR: {ex.GetType().Name}");
            }

            if (onceMode)
            {
                break;
            }

            try
            {
                await Task.Delay(intervalMs, cts.Token);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        return 0;
    }

    private static ForegroundSamplePayload? CaptureForeground()
    {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero)
        {
            return new ForegroundSamplePayload(
                DateTime.UtcNow.ToString("o"),
                "",
                "",
                0
            );
        }

        GetWindowThreadProcessId(hwnd, out uint pid);

        string windowTitle = "";
        var titleBuffer = new StringBuilder(512);
        int titleLength = GetWindowText(hwnd, titleBuffer, titleBuffer.Capacity);
        if (titleLength > 0)
        {
            windowTitle = titleBuffer.ToString();
        }

        string processName = "";
        if (pid > 0)
        {
            processName = GetProcessNameByPid(pid);
        }

        return new ForegroundSamplePayload(
            DateTime.UtcNow.ToString("o"),
            processName,
            windowTitle,
            (int)pid
        );
    }

    private static string GetProcessNameByPid(uint pid)
    {
        IntPtr hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (hProcess != IntPtr.Zero)
        {
            try
            {
                var pathBuffer = new StringBuilder(1024);
                uint size = (uint)pathBuffer.Capacity;
                if (QueryFullProcessImageName(hProcess, 0, pathBuffer, ref size))
                {
                    string fullPath = pathBuffer.ToString();
                    return Path.GetFileNameWithoutExtension(fullPath);
                }
            }
            finally
            {
                CloseHandle(hProcess);
            }
        }

        // 回退机制
        try
        {
            using var proc = Process.GetProcessById((int)pid);
            return proc.ProcessName;
        }
        catch
        {
            return "";
        }
    }
}
