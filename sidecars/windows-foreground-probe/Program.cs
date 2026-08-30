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
    private const uint WS_POPUP = 0x80000000;
    private const uint WS_EX_TOPMOST = 0x00000008;
    private const uint WS_EX_TOOLWINDOW = 0x00000080;
    private const int SW_SHOWNOACTIVATE = 4;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;
    private const uint WM_PAINT = 0x000F;
    private const uint WM_ERASEBKGND = 0x0014;
    private const uint WM_DESTROY = 0x0002;
    private static readonly IntPtr HWND_TOPMOST = new(-1);
    private static readonly WindowProc AcceptanceWindowProc = HandleAcceptanceWindowMessage;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WindowClassEx
    {
        public uint Size;
        public uint Style;
        public IntPtr WindowProc;
        public int ClassExtra;
        public int WindowExtra;
        public IntPtr Instance;
        public IntPtr Icon;
        public IntPtr Cursor;
        public IntPtr Background;
        public IntPtr MenuName;
        [MarshalAs(UnmanagedType.LPWStr)] public string ClassName;
        public IntPtr SmallIcon;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeMessage
    {
        public IntPtr Window;
        public uint Message;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public int PointX;
        public int PointY;
        public uint Private;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PaintStruct
    {
        public IntPtr DeviceContext;
        [MarshalAs(UnmanagedType.Bool)] public bool Erase;
        public NativeRect PaintRect;
        [MarshalAs(UnmanagedType.Bool)] public bool Restore;
        [MarshalAs(UnmanagedType.Bool)] public bool IncrementalUpdate;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] Reserved;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate IntPtr WindowProc(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);

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

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? moduleName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern ushort RegisterClassEx(ref WindowClassEx windowClass);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(
        uint extendedStyle,
        string className,
        string windowName,
        uint style,
        int x,
        int y,
        int width,
        int height,
        IntPtr parent,
        IntPtr menu,
        IntPtr instance,
        IntPtr parameter
    );

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(
        IntPtr window,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags
    );

    [DllImport("user32.dll")]
    private static extern int GetMessage(out NativeMessage message, IntPtr window, uint minimum, uint maximum);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TranslateMessage(ref NativeMessage message);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref NativeMessage message);

    [DllImport("user32.dll")]
    private static extern IntPtr DefWindowProc(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern void PostQuitMessage(int exitCode);

    [DllImport("user32.dll")]
    private static extern IntPtr BeginPaint(IntPtr window, out PaintStruct paint);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EndPaint(IntPtr window, ref PaintStruct paint);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetClientRect(IntPtr window, out NativeRect rect);

    [DllImport("user32.dll")]
    private static extern int FillRect(IntPtr deviceContext, ref NativeRect rect, IntPtr brush);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateSolidBrush(uint color);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteObject(IntPtr graphicsObject);

    public static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;

        if (args.Length > 0 && args[0] == "--acceptance-control-window")
        {
            if (!TryParseAcceptanceControlBounds(args, out var controlBounds))
            {
                Console.Error.WriteLine("ACCEPTANCE_CONTROL_ARGS_INVALID");
                return 1;
            }

            return RunAcceptanceControlWindow(controlBounds.X, controlBounds.Y, controlBounds.Width, controlBounds.Height);
        }

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

    private static bool TryParseAcceptanceControlBounds(
        string[] args,
        out (int X, int Y, int Width, int Height) bounds
    )
    {
        bounds = default;
        if (args.Length != 5 || args[0] != "--acceptance-control-window")
        {
            return false;
        }

        if (!int.TryParse(args[1], out int x) ||
            !int.TryParse(args[2], out int y) ||
            !int.TryParse(args[3], out int width) ||
            !int.TryParse(args[4], out int height) ||
            x < -32768 || y < -32768 || width < 220 || height < 160 ||
            width > 4096 || height > 2160)
        {
            return false;
        }

        bounds = (x, y, width, height);
        return true;
    }

    private static int RunAcceptanceControlWindow(int x, int y, int width, int height)
    {
        IntPtr instance = GetModuleHandle(null);
        string className = $"XingbanAcceptanceControl_{Environment.ProcessId}";
        var windowClass = new WindowClassEx
        {
            Size = (uint)Marshal.SizeOf<WindowClassEx>(),
            WindowProc = Marshal.GetFunctionPointerForDelegate(AcceptanceWindowProc),
            Instance = instance,
            ClassName = className,
        };
        if (RegisterClassEx(ref windowClass) == 0)
        {
            Console.Error.WriteLine("ACCEPTANCE_CONTROL_REGISTER_FAILED");
            return 1;
        }

        IntPtr window = CreateWindowEx(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            className,
            "",
            WS_POPUP,
            x,
            y,
            width,
            height,
            IntPtr.Zero,
            IntPtr.Zero,
            instance,
            IntPtr.Zero
        );
        if (window == IntPtr.Zero)
        {
            Console.Error.WriteLine("ACCEPTANCE_CONTROL_CREATE_FAILED");
            return 1;
        }

        ShowWindow(window, SW_SHOWNOACTIVATE);
        SetWindowPos(
            window,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW
        );
        UpdateWindow(window);
        Console.WriteLine("XINGBAN_CONTROL_READY");
        Console.Out.Flush();

        while (GetMessage(out NativeMessage message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
        return 0;
    }

    private static IntPtr HandleAcceptanceWindowMessage(
        IntPtr window,
        uint message,
        UIntPtr wParam,
        IntPtr lParam
    )
    {
        if (message == WM_ERASEBKGND)
        {
            return new IntPtr(1);
        }
        if (message == WM_PAINT)
        {
            IntPtr deviceContext = BeginPaint(window, out PaintStruct paint);
            if (GetClientRect(window, out NativeRect rect))
            {
                int midpoint = rect.Left + ((rect.Right - rect.Left) / 2);
                var left = new NativeRect { Left = rect.Left, Top = rect.Top, Right = midpoint, Bottom = rect.Bottom };
                var right = new NativeRect { Left = midpoint, Top = rect.Top, Right = rect.Right, Bottom = rect.Bottom };
                IntPtr cyan = CreateSolidBrush(0x00FFFF00);
                IntPtr yellow = CreateSolidBrush(0x0000FFFF);
                FillRect(deviceContext, ref left, cyan);
                FillRect(deviceContext, ref right, yellow);
                DeleteObject(cyan);
                DeleteObject(yellow);
            }
            EndPaint(window, ref paint);
            return IntPtr.Zero;
        }
        if (message == WM_DESTROY)
        {
            PostQuitMessage(0);
            return IntPtr.Zero;
        }
        return DefWindowProc(window, message, wParam, lParam);
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
