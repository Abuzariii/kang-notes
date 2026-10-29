// kang-notes for Windows: a window that shows the kang-notes app through Microsoft Edge
// WebView2 (part of Windows), plus what a web page can't do on its own:
//   - two layouts: Simple (normal window) and Focus (small, frameless, always on top),
//     each remembering its own size and place;
//   - Ctrl+Alt+N from anywhere brings kang-notes forward, ready for a quick note;
//   - backups to a folder on D:, starting with Windows, and keeping to a single window.
//
// Everything it writes stays next to it on D:
//   ..\data\webview\   the app's offline copy of your notes, sign-in, and cache
//   ..\data\window.txt layout, window positions and sizes
//   ..\backups\        backup files
//
// Built by desktop\build.ps1 with the C# compiler that comes with Windows (C# 5).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("kang-notes")]
[assembly: System.Reflection.AssemblyProduct("kang-notes")]
[assembly: System.Reflection.AssemblyVersion("1.1.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.1.0.0")]

namespace KangNotes
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            bool first;
            using (var mutex = new Mutex(true, "KangNotes.SingleInstance", out first))
            {
                if (!first)
                {
                    Native.ShowExisting(MainForm.WindowTitle);
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm(args));
            }
        }
    }

    static class Native
    {
        public const int WM_NCHITTEST = 0x84;
        public const int WM_NCLBUTTONDOWN = 0xA1;
        public const int WM_HOTKEY = 0x312;
        public const int HTCLIENT = 1;
        public const int HTCAPTION = 2;
        public const int HTLEFT = 10, HTRIGHT = 11, HTTOP = 12, HTTOPLEFT = 13, HTTOPRIGHT = 14;
        public const int HTBOTTOM = 15, HTBOTTOMLEFT = 16, HTBOTTOMRIGHT = 17;

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr FindWindow(string className, string title);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hwnd);

        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hwnd, int command);

        [DllImport("user32.dll")]
        static extern bool IsIconic(IntPtr hwnd);

        [DllImport("user32.dll")]
        public static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        public static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool RegisterHotKey(IntPtr hwnd, int id, int modifiers, int key);

        [DllImport("user32.dll")]
        public static extern bool UnregisterHotKey(IntPtr hwnd, int id);

        // A second launch brings the open window to the front instead of opening another.
        public static void ShowExisting(string title)
        {
            IntPtr hwnd = FindWindow(null, title);
            if (hwnd == IntPtr.Zero) return;
            if (IsIconic(hwnd)) ShowWindow(hwnd, 9); // SW_RESTORE
            SetForegroundWindow(hwnd);
        }
    }

    class MainForm : Form
    {
        public const string WindowTitle = "kang-notes";
        const string DefaultUrl = "https://kang-notes.web.app/";
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        const string RunValue = "kang-notes";
        const int HotkeyId = 1;
        static readonly Color AppBack = Color.FromArgb(5, 7, 13);
        static readonly Color FocusEdge = Color.FromArgb(38, 46, 66); // the thin frame you grab to resize Focus

        readonly string dataDir;
        readonly string backupDir;
        readonly string windowFile;
        readonly string startUrl;
        readonly Uri appUri;
        readonly bool devMode;
        readonly string debugPort;
        readonly float scale;
        readonly WebView2 web;
        readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        string mode = "simple";
        Rectangle simpleBounds;
        bool simpleMaximized;
        Rectangle focusBounds;
        string modeScriptId;

        public MainForm(string[] args)
        {
            string rootDir = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
            dataDir = Path.Combine(rootDir, "data");
            backupDir = Path.Combine(rootDir, "backups");
            windowFile = Path.Combine(dataDir, "window.txt");
            startUrl = ArgValue(args, "--url") ?? DefaultUrl;
            appUri = new Uri(startUrl);
            devMode = args.Contains("--dev");
            debugPort = ArgValue(args, "--debug-port"); // only for test\desktop.mjs
            using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) scale = g.DpiX / 96f;

            Text = WindowTitle;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            StartPosition = FormStartPosition.Manual;

            web = new WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = AppBack;
            Controls.Add(web);

            LoadWindowState();
            ApplyMode(mode, true);

            Load += async (s, e) => await StartWebView();
            ResizeEnd += (s, e) => SaveWindow();
            FormClosing += (s, e) => SaveWindow();
        }

        int Px(int value)
        {
            return (int)Math.Round(value * scale);
        }

        static string ArgValue(string[] args, string name)
        {
            int i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }

        // Lets the frameless Focus window be minimized from the taskbar too.
        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.Style |= 0x00020000; // WS_MINIMIZEBOX
                return cp;
            }
        }

        // ---------- layouts ----------

        void ApplyMode(string next, bool initial)
        {
            if (!initial) RememberBounds();
            mode = next == "focus" ? "focus" : "simple";
            SuspendLayout();
            if (mode == "focus")
            {
                WindowState = FormWindowState.Normal;
                FormBorderStyle = FormBorderStyle.None;
                MaximizeBox = false;
                Padding = new Padding(Px(5));
                BackColor = FocusEdge;
                MinimumSize = new Size(Px(300), Px(320));
                Bounds = focusBounds;
                TopMost = true;
            }
            else
            {
                TopMost = false;
                FormBorderStyle = FormBorderStyle.Sizable;
                MaximizeBox = true;
                Padding = Padding.Empty;
                BackColor = AppBack;
                MinimumSize = new Size(Px(360), Px(480));
                Bounds = simpleBounds;
                if (simpleMaximized) WindowState = FormWindowState.Maximized;
            }
            ResumeLayout();
            if (!initial)
            {
                SaveWindow();
                UpdateModeScript();
            }
        }

        void RememberBounds()
        {
            if (mode == "focus")
            {
                if (WindowState == FormWindowState.Normal) focusBounds = Bounds;
            }
            else
            {
                simpleMaximized = WindowState == FormWindowState.Maximized;
                simpleBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            }
        }

        // Focus has no Windows frame: the strip around the page is a resize handle.
        protected override void WndProc(ref Message m)
        {
            if (m.Msg == Native.WM_HOTKEY && m.WParam.ToInt32() == HotkeyId)
            {
                Summon();
                return;
            }
            base.WndProc(ref m);
            if (m.Msg != Native.WM_NCHITTEST || mode != "focus" || m.Result.ToInt32() != Native.HTCLIENT) return;
            int lp = unchecked((int)m.LParam.ToInt64());
            Point p = PointToClient(new Point((short)(lp & 0xFFFF), (short)((lp >> 16) & 0xFFFF)));
            int edge = Padding.Left;
            int corner = edge * 3;
            bool left = p.X < edge, right = p.X >= ClientSize.Width - edge;
            bool top = p.Y < edge, bottom = p.Y >= ClientSize.Height - edge;
            bool nearLeft = p.X < corner, nearRight = p.X >= ClientSize.Width - corner;
            bool nearTop = p.Y < corner, nearBottom = p.Y >= ClientSize.Height - corner;
            int hit = Native.HTCLIENT;
            if ((top && nearLeft) || (left && nearTop)) hit = Native.HTTOPLEFT;
            else if ((top && nearRight) || (right && nearTop)) hit = Native.HTTOPRIGHT;
            else if ((bottom && nearLeft) || (left && nearBottom)) hit = Native.HTBOTTOMLEFT;
            else if ((bottom && nearRight) || (right && nearBottom)) hit = Native.HTBOTTOMRIGHT;
            else if (left) hit = Native.HTLEFT;
            else if (right) hit = Native.HTRIGHT;
            else if (top) hit = Native.HTTOP;
            else if (bottom) hit = Native.HTBOTTOM;
            m.Result = (IntPtr)hit;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            // Ctrl+Alt+N. If another program already uses it, kang-notes simply goes without.
            Native.RegisterHotKey(Handle, HotkeyId, 0x0001 | 0x0002 | 0x4000, (int)Keys.N);
        }

        protected override void OnHandleDestroyed(EventArgs e)
        {
            Native.UnregisterHotKey(Handle, HotkeyId);
            base.OnHandleDestroyed(e);
        }

        void Summon()
        {
            if (WindowState == FormWindowState.Minimized)
                WindowState = mode == "simple" && simpleMaximized ? FormWindowState.Maximized : FormWindowState.Normal;
            Activate();
            Native.SetForegroundWindow(Handle);
            web.Focus();
            PostEvent("summon");
        }

        void PostEvent(string name)
        {
            if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson("{\"event\":\"" + name + "\"}");
        }

        // Fallback for dragging Focus by its top bar if WebView2's own drag regions aren't available.
        void StartDrag()
        {
            if (mode != "focus" || WindowState != FormWindowState.Normal) return;
            Native.ReleaseCapture();
            Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, (IntPtr)Native.HTCAPTION, IntPtr.Zero);
            SaveWindow();
        }

        // ---------- web view ----------

        async Task StartWebView()
        {
            try
            {
                Directory.CreateDirectory(dataDir);
                var options = new CoreWebView2EnvironmentOptions();
                int port;
                if (int.TryParse(debugPort, out port)) options.AdditionalBrowserArguments = "--remote-debugging-port=" + port;
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDir, "webview"), options);
                await web.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this,
                    "kang-notes couldn't start Microsoft Edge WebView2, which it uses to draw its window.\n\n" + ex.Message +
                    "\n\nWebView2 comes with Windows 10 and 11. If it has been removed, reinstall it from https://go.microsoft.com/fwlink/p/?LinkId=2124703",
                    WindowTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
                return;
            }

            CoreWebView2 core = web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = devMode;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;   // Ctrl+wheel zooms the graph, not the page
            core.Settings.IsPinchZoomEnabled = false;
            core.Settings.IsSwipeNavigationEnabled = false;
            core.Settings.IsNonClientRegionSupportEnabled = true; // CSS app-region: drag moves the Focus window
            core.NewWindowRequested += (s, e) =>
            {
                e.Handled = true;
                OpenExternal(e.Uri);
            };
            core.NavigationStarting += OnNavigationStarting;
            core.NavigationCompleted += OnNavigationCompleted;
            core.WebMessageReceived += OnWebMessage;
            core.ProcessFailed += (s, e) =>
            {
                if (e.ProcessFailedKind != CoreWebView2ProcessFailedKind.BrowserProcessExited) core.Reload();
            };
            await UpdateModeScriptAsync();
            core.Navigate(startUrl);
        }

        // The page reads window.kangHost.mode as it starts, to open in the right layout.
        async void UpdateModeScript()
        {
            try { await UpdateModeScriptAsync(); }
            catch (Exception) { }
        }

        async Task UpdateModeScriptAsync()
        {
            CoreWebView2 core = web.CoreWebView2;
            if (core == null) return;
            if (modeScriptId != null) core.RemoveScriptToExecuteOnDocumentCreated(modeScriptId);
            modeScriptId = await core.AddScriptToExecuteOnDocumentCreatedAsync("window.kangHost = { mode: '" + mode + "' };");
        }

        bool IsAppUri(Uri uri)
        {
            return Uri.Compare(uri, appUri, UriComponents.SchemeAndServer, UriFormat.Unescaped, StringComparison.OrdinalIgnoreCase) == 0;
        }

        // Only kang-notes itself opens inside the window; any other link goes to your browser.
        void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            Uri uri;
            if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out uri)) return;
            if (uri.Scheme == "about" || uri.Scheme == "data" || IsAppUri(uri)) return;
            e.Cancel = true;
            OpenExternal(e.Uri);
        }

        // The very first start needs the internet to fetch the app; after that it opens offline.
        void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.IsSuccess || e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
            if (!IsAppUri(new Uri(web.CoreWebView2.Source))) return;
            web.CoreWebView2.NavigateToString(OfflinePage);
        }

        static void OpenExternal(string url)
        {
            Uri uri;
            if (!Uri.TryCreate(url, UriKind.Absolute, out uri)) return;
            if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeMailto) return;
            try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
            catch (Exception) { }
        }

        // Requests from web/src/host.js. Each has a type and an id; the reply echoes the id.
        void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            Dictionary<string, object> msg;
            try { msg = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson); }
            catch (Exception) { return; }
            if (msg == null) return;
            string type = Get(msg, "type");
            if (type == "retry")
            {
                web.CoreWebView2.Navigate(startUrl);
                return;
            }
            Uri source;
            if (!Uri.TryCreate(e.Source, UriKind.Absolute, out source) || !IsAppUri(source)) return;
            if (type == "drag")
            {
                StartDrag();
                return;
            }

            var reply = new Dictionary<string, object>();
            reply["reply"] = Get(msg, "id");
            try
            {
                switch (type)
                {
                    case "info":
                        AddInfo(reply);
                        break;
                    case "mode":
                        if (Get(msg, "mode") != mode) ApplyMode(Get(msg, "mode"), false);
                        AddInfo(reply);
                        break;
                    case "window":
                        if (Get(msg, "action") == "minimize") WindowState = FormWindowState.Minimized;
                        else if (Get(msg, "action") == "close") BeginInvoke(new Action(Close));
                        break;
                    case "backup":
                        reply["path"] = SaveBackup(Get(msg, "fileName"), Get(msg, "content"));
                        break;
                    case "open-backups":
                        Directory.CreateDirectory(backupDir);
                        Process.Start("explorer.exe", "\"" + backupDir + "\"");
                        break;
                    case "autostart":
                        object on;
                        SetAutostart(msg.TryGetValue("on", out on) && on is bool && (bool)on);
                        AddInfo(reply);
                        break;
                    default:
                        reply["error"] = "Unknown request: " + type;
                        break;
                }
            }
            catch (Exception ex)
            {
                reply["error"] = ex.Message;
            }
            web.CoreWebView2.PostWebMessageAsJson(json.Serialize(reply));
        }

        static string Get(Dictionary<string, object> msg, string key)
        {
            object value;
            return msg.TryGetValue(key, out value) && value != null ? value.ToString() : "";
        }

        void AddInfo(Dictionary<string, object> reply)
        {
            reply["autostart"] = IsAutostart();
            reply["backupDir"] = backupDir;
            reply["dataDir"] = dataDir;
            reply["mode"] = mode;
            reply["topMost"] = TopMost;
            reply["frameless"] = FormBorderStyle == FormBorderStyle.None;
            reply["bounds"] = new[] { Bounds.X, Bounds.Y, Bounds.Width, Bounds.Height };
            reply["window"] = Handle.ToInt64();
        }

        string SaveBackup(string fileName, string content)
        {
            string name = Path.GetFileName(fileName ?? "");
            foreach (char c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '-');
            if (name.Length == 0) name = "kang-notes-backup.json";
            if (!name.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) name += ".json";
            Directory.CreateDirectory(backupDir);
            string path = Path.Combine(backupDir, name);
            File.WriteAllText(path, content ?? "", new UTF8Encoding(false));
            return path;
        }

        static string ExeCommand()
        {
            return "\"" + Application.ExecutablePath + "\"";
        }

        static bool IsAutostart()
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKey))
            {
                object value = key == null ? null : key.GetValue(RunValue);
                return value != null && string.Equals(value.ToString(), ExeCommand(), StringComparison.OrdinalIgnoreCase);
            }
        }

        static void SetAutostart(bool on)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (on) key.SetValue(RunValue, ExeCommand());
                else key.DeleteValue(RunValue, false);
            }
        }

        // ---------- remembering where the window was ----------
        // window.txt holds lines like:  mode=focus | simple=x,y,w,h,max | focus=x,y,w,h

        void LoadWindowState()
        {
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            simpleBounds = new Rectangle(0, 0, Math.Min(1500, area.Width * 4 / 5), Math.Min(950, area.Height * 5 / 6));
            simpleBounds.Offset(area.Left + (area.Width - simpleBounds.Width) / 2, area.Top + (area.Height - simpleBounds.Height) / 2);
            int fw = Math.Min(Px(420), area.Width - Px(48));
            int fh = Math.Min(Px(680), area.Height - Px(48));
            focusBounds = new Rectangle(area.Right - fw - Px(24), area.Top + Px(24), fw, fh);
            try
            {
                foreach (string line in File.ReadAllLines(windowFile))
                {
                    int eq = line.IndexOf('=');
                    if (eq < 0) continue;
                    string key = line.Substring(0, eq).Trim();
                    string[] v = line.Substring(eq + 1).Trim().Split(',');
                    if (key == "mode") mode = v[0] == "focus" ? "focus" : "simple";
                    else if (key == "simple" && v.Length >= 4)
                    {
                        Rectangle r = ParseRect(v);
                        if (OnScreen(r))
                        {
                            simpleBounds = r;
                            simpleMaximized = v.Length > 4 && v[4] == "max";
                        }
                    }
                    else if (key == "focus" && v.Length >= 4)
                    {
                        Rectangle r = ParseRect(v);
                        if (OnScreen(r)) focusBounds = r;
                    }
                }
            }
            catch (Exception) { }
        }

        static Rectangle ParseRect(string[] v)
        {
            return new Rectangle(
                int.Parse(v[0], CultureInfo.InvariantCulture), int.Parse(v[1], CultureInfo.InvariantCulture),
                int.Parse(v[2], CultureInfo.InvariantCulture), int.Parse(v[3], CultureInfo.InvariantCulture));
        }

        // Only reuse a saved place if most of the window would be on a screen you still have.
        static bool OnScreen(Rectangle r)
        {
            return r.Width > 0 && r.Height > 0 && Screen.AllScreens.Any(s =>
            {
                Rectangle i = Rectangle.Intersect(s.WorkingArea, r);
                return i.Width * i.Height > r.Width * r.Height / 3;
            });
        }

        static string Rect(Rectangle r)
        {
            return string.Join(",", new[] { r.X, r.Y, r.Width, r.Height }.Select(n => n.ToString(CultureInfo.InvariantCulture)));
        }

        void SaveWindow()
        {
            try
            {
                if (WindowState != FormWindowState.Minimized) RememberBounds();
                Directory.CreateDirectory(dataDir);
                File.WriteAllLines(windowFile, new[] {
                    "mode=" + mode,
                    "simple=" + Rect(simpleBounds) + "," + (simpleMaximized ? "max" : "normal"),
                    "focus=" + Rect(focusBounds),
                });
            }
            catch (Exception) { }
        }

        const string OfflinePage = @"<!doctype html><html><head><meta charset='utf-8'><title>kang-notes</title>
<style>
  html,body{margin:0;height:100%;background:#05070d;color:#e8edf7;font:15px/1.5 'Segoe UI',sans-serif}
  body{display:grid;place-items:center}
  .card{max-width:420px;margin:16px;padding:28px;border:1px solid rgba(255,255,255,.09);border-radius:16px;background:#0c101b;text-align:center}
  h1{margin:0 0 8px;font-size:20px} p{margin:0 0 18px;color:#8e98ab}
  button{height:40px;padding:0 18px;border:0;border-radius:10px;background:#6ee7ff;color:#04161c;font:600 14px 'Segoe UI',sans-serif;cursor:pointer}
</style></head><body><div class='card'>
  <h1>Can't reach kang-notes</h1>
  <p>The first time it opens, kang-notes needs the internet to download itself. After that it also works offline.</p>
  <button onclick=""chrome.webview.postMessage({type:'retry'})"">Try again</button>
</div></body></html>";
    }
}
