using Microsoft.Win32;
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

namespace MDFlowViewer
{
    internal static class Program
    {
        private const string ProgId = "MDFlow.Viewer";
        private const string AppName = "MD Flow Viewer";
        private static readonly RegistryKey UserRoot = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, RegistryView.Registry64);

        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                if (args.Any(a => string.Equals(a, "--install", StringComparison.OrdinalIgnoreCase)))
                {
                    InstallFileAssociations();
                    if (!args.Any(a => string.Equals(a, "--quiet", StringComparison.OrdinalIgnoreCase)))
                    {
                        MessageBox.Show(
                            ".md ve .markdown dosya iliskilendirmeleri MD Flow Viewer icin ayarlandi.",
                            AppName,
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Information);
                    }
                    return 0;
                }

                string filePath = args.FirstOrDefault(a => !a.StartsWith("--", StringComparison.Ordinal));
                int port = GetAvailablePort();
                LaunchServer(port);
                OpenViewer(filePath, port);
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.Message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        private static string AppDirectory
        {
            get { return AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar); }
        }

        private static string ExePath
        {
            get { return Path.Combine(AppDirectory, "MDFlowViewer.exe"); }
        }

        private static string IconPath
        {
            get { return Path.Combine(AppDirectory, "public", "mdflow.ico"); }
        }

        private static int GetAvailablePort()
        {
            TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            return port;
        }

        private static void LaunchServer(int port)
        {
            string serverPath = Path.Combine(AppDirectory, "server.js");
            if (!File.Exists(serverPath))
            {
                throw new FileNotFoundException("server.js bulunamadi.", serverPath);
            }

            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = "node.exe",
                Arguments = "server.js",
                WorkingDirectory = AppDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            startInfo.EnvironmentVariables["MDVIEWER_AUTO_EXIT"] = "1";
            startInfo.EnvironmentVariables["PORT"] = port.ToString();

            Process.Start(startInfo);
            WaitForServer(port);
        }

        private static void WaitForServer(int port)
        {
            for (int i = 0; i < 20; i++)
            {
                try
                {
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/health");
                    request.Timeout = 350;
                    request.ReadWriteTimeout = 350;
                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    {
                        if ((int)response.StatusCode < 500) return;
                    }
                }
                catch
                {
                    Thread.Sleep(150);
                }
            }
        }

        private static void OpenViewer(string filePath, int port)
        {
            string url = "http://127.0.0.1:" + port;
            if (!string.IsNullOrWhiteSpace(filePath))
            {
                url += "/?file=" + Uri.EscapeDataString(Path.GetFullPath(filePath));
            }

            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = "msedge.exe",
                Arguments = "--app=\"" + url + "\"",
                UseShellExecute = true
            };

            Process.Start(startInfo);
        }

        private static void InstallFileAssociations()
        {
            RegisterExtension(".md");
            RegisterExtension(".markdown");

            using (RegistryKey progId = UserRoot.CreateSubKey(@"Software\Classes\" + ProgId))
            {
                if (progId != null) progId.SetValue("", "Markdown Belgesi");
            }

            using (RegistryKey defaultIcon = UserRoot.CreateSubKey(@"Software\Classes\" + ProgId + @"\DefaultIcon"))
            {
                if (defaultIcon != null) defaultIcon.SetValue("", "\"" + IconPath + "\"");
            }

            using (RegistryKey shellOpen = UserRoot.CreateSubKey(@"Software\Classes\" + ProgId + @"\shell\open"))
            {
                if (shellOpen != null)
                {
                    shellOpen.SetValue("", "MD Flow Viewer ile Ac");
                    shellOpen.SetValue("Icon", IconPath);
                }
            }

            using (RegistryKey command = UserRoot.CreateSubKey(@"Software\Classes\" + ProgId + @"\shell\open\command"))
            {
                if (command != null) command.SetValue("", "\"" + ExePath + "\" \"%1\"");
            }

            RegisterApplication();
            RegisterContextMenu(".md");
            RegisterContextMenu(".markdown");

            UserRoot.DeleteSubKeyTree(@"Software\Classes\Applications\run.bat", false);
            UserRoot.DeleteSubKeyTree(@"Software\Classes\Applications\launch-hidden.vbs", false);
        }

        private static void RegisterExtension(string extension)
        {
            using (RegistryKey extKey = UserRoot.CreateSubKey(@"Software\Classes\" + extension))
            {
                if (extKey != null) extKey.SetValue("", ProgId);
            }

            using (RegistryKey openWith = UserRoot.CreateSubKey(@"Software\Classes\" + extension + @"\OpenWithProgids"))
            {
                if (openWith != null) openWith.SetValue(ProgId, "", RegistryValueKind.String);
            }
        }

        private static void RegisterApplication()
        {
            using (RegistryKey app = UserRoot.CreateSubKey(@"Software\Classes\Applications\MDFlowViewer.exe"))
            {
                if (app != null) app.SetValue("", AppName);
            }

            using (RegistryKey icon = UserRoot.CreateSubKey(@"Software\Classes\Applications\MDFlowViewer.exe\DefaultIcon"))
            {
                if (icon != null) icon.SetValue("", "\"" + IconPath + "\"");
            }

            using (RegistryKey open = UserRoot.CreateSubKey(@"Software\Classes\Applications\MDFlowViewer.exe\shell\open"))
            {
                if (open != null)
                {
                    open.SetValue("", "MD Flow Viewer ile Ac");
                    open.SetValue("Icon", IconPath);
                }
            }

            using (RegistryKey command = UserRoot.CreateSubKey(@"Software\Classes\Applications\MDFlowViewer.exe\shell\open\command"))
            {
                if (command != null) command.SetValue("", "\"" + ExePath + "\" \"%1\"");
            }

            using (RegistryKey supportedTypes = UserRoot.CreateSubKey(@"Software\Classes\Applications\MDFlowViewer.exe\SupportedTypes"))
            {
                if (supportedTypes != null)
                {
                    supportedTypes.SetValue(".md", "");
                    supportedTypes.SetValue(".markdown", "");
                }
            }
        }

        private static void RegisterContextMenu(string extension)
        {
            using (RegistryKey menu = UserRoot.CreateSubKey(@"Software\Classes\SystemFileAssociations\" + extension + @"\shell\OpenWithMDFlow"))
            {
                if (menu != null)
                {
                    menu.SetValue("", "MD Flow Viewer ile Ac");
                    menu.SetValue("Icon", IconPath);
                }
            }

            using (RegistryKey command = UserRoot.CreateSubKey(@"Software\Classes\SystemFileAssociations\" + extension + @"\shell\OpenWithMDFlow\command"))
            {
                if (command != null) command.SetValue("", "\"" + ExePath + "\" \"%1\"");
            }
        }
    }
}
