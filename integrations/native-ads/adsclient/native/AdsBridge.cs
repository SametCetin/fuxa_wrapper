// Windows x64 helper. JSON lines on stdin/stdout; diagnostics go to stderr.
// Uses the installed Beckhoff router through TcAdsDll instead of TCP loopback.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

internal static class AdsBridge {
    const int MaxBytes = 16 * 1024 * 1024;
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    struct AmsAddr {
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)] public byte[] NetId;
        public ushort Port;
    }
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    struct AdsVersion { public byte Major, Minor; public ushort Build; }
    [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr LoadLibraryW(string path);
    [DllImport("TcAdsDll.dll")] static extern int AdsPortOpenEx();
    [DllImport("TcAdsDll.dll")] static extern int AdsPortCloseEx(int port);
    [DllImport("TcAdsDll.dll")] static extern int AdsGetLocalAddressEx(int port, ref AmsAddr addr);
    [DllImport("TcAdsDll.dll")] static extern int AdsSyncSetTimeoutEx(int port, uint timeout);
    [DllImport("TcAdsDll.dll")] static extern int AdsSyncReadStateReqEx(int port, ref AmsAddr addr, out ushort state, out ushort device);
    [DllImport("TcAdsDll.dll")] static extern int AdsSyncReadDeviceInfoReqEx(int port, ref AmsAddr addr, [Out] byte[] name, out AdsVersion version);
    [DllImport("TcAdsDll.dll")] static extern int AdsSyncReadReqEx2(int port, ref AmsAddr addr, uint group, uint offset, uint length, [Out] byte[] data, out uint read);
    [DllImport("TcAdsDll.dll")] static extern int AdsSyncReadWriteReqEx2(int port, ref AmsAddr addr, uint group, uint offset, uint readLength, [Out] byte[] readData, uint writeLength, byte[] writeData, out uint read);
    [DllImport("TcAdsDll.dll")] static extern int AdsSyncWriteReqEx(int port, ref AmsAddr addr, uint group, uint offset, uint length, byte[] data);

    sealed class AdsException : Exception {
        public readonly int Code;
        public AdsException(int code) : base("Native ADS error " + code + " (0x" + code.ToString("X") + ")") { Code = code; }
    }
    static void Check(int code) { if (code != 0) throw new AdsException(code); }
    static void Need(byte[] data, int length) { if (data.Length < length) throw new ArgumentException("Truncated ADS request"); }
    static uint U32(byte[] data, int pos) { return BitConverter.ToUInt32(data, pos); }
    static int Capacity(uint requested) {
        // ads-client uses UINT_MAX when the symbol/datatype response size is unknown.
        if (requested == uint.MaxValue) return MaxBytes;
        if (requested > MaxBytes) throw new ArgumentException("ADS request exceeds 16 MiB");
        return (int)requested;
    }
    static AmsAddr Address(string netId, int port) {
        string[] parts = netId.Split('.');
        if (parts.Length != 6 || port < 1 || port > ushort.MaxValue) throw new ArgumentException("Invalid AMS address");
        byte[] id = new byte[6];
        for (int i = 0; i < 6; i++) id[i] = byte.Parse(parts[i]);
        return new AmsAddr { NetId = id, Port = (ushort)port };
    }
    static byte[] Request(int localPort, AmsAddr addr, int command, byte[] payload) {
        using (var output = new MemoryStream()) using (var writer = new BinaryWriter(output)) {
            writer.Write(0); // ADS success; failures are sent as structured JSON errors.
            switch (command) {
                case 1: {
                    var name = new byte[16]; AdsVersion version;
                    Check(AdsSyncReadDeviceInfoReqEx(localPort, ref addr, name, out version));
                    writer.Write(version.Major); writer.Write(version.Minor); writer.Write(version.Build); writer.Write(name);
                    break;
                }
                case 2: {
                    Need(payload, 12);
                    var data = new byte[Capacity(U32(payload, 8))]; uint read;
                    Check(AdsSyncReadReqEx2(localPort, ref addr, U32(payload, 0), U32(payload, 4), (uint)data.Length, data, out read));
                    if (read > data.Length) throw new InvalidDataException("Invalid ADS response length");
                    writer.Write(read); writer.Write(data, 0, (int)read);
                    break;
                }
                case 3: {
                    Need(payload, 12); uint length = U32(payload, 8);
                    if (length > MaxBytes || length != payload.Length - 12) throw new ArgumentException("Invalid ADS write length");
                    var data = new byte[(int)length]; Array.Copy(payload, 12, data, 0, data.Length);
                    Check(AdsSyncWriteReqEx(localPort, ref addr, U32(payload, 0), U32(payload, 4), length, data));
                    break;
                }
                case 4: {
                    ushort state, device;
                    Check(AdsSyncReadStateReqEx(localPort, ref addr, out state, out device));
                    writer.Write(state); writer.Write(device);
                    break;
                }
                case 9: {
                    Need(payload, 16); uint length = U32(payload, 12);
                    if (length > MaxBytes || length != payload.Length - 16) throw new ArgumentException("Invalid ADS read/write length");
                    var data = new byte[Capacity(U32(payload, 8))];
                    var write = new byte[(int)length]; Array.Copy(payload, 16, write, 0, write.Length); uint read;
                    Check(AdsSyncReadWriteReqEx2(localPort, ref addr, U32(payload, 0), U32(payload, 4), (uint)data.Length, data, length, write, out read));
                    if (read > data.Length) throw new InvalidDataException("Invalid ADS response length");
                    writer.Write(read); writer.Write(data, 0, (int)read);
                    break;
                }
                default: throw new NotSupportedException("Unsupported ADS command: " + command);
            }
            return output.ToArray();
        }
    }
    static string FindDll() {
        string[] paths = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Beckhoff", "TwinCAT", "Common64", "TcAdsDll.dll"),
            @"C:\TwinCAT\Common64\TcAdsDll.dll"
        };
        foreach (string path in paths) if (File.Exists(path)) return path;
        throw new FileNotFoundException("Beckhoff x64 TcAdsDll.dll is not installed");
    }
    static int Main() {
        int port = 0;
        var json = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
        try {
            if (IntPtr.Size != 8) throw new PlatformNotSupportedException("The ADS helper requires Windows x64");
            if (LoadLibraryW(FindDll()) == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            port = AdsPortOpenEx();
            if (port == 0) throw new InvalidOperationException("Could not open the local TwinCAT ADS router");
            Check(AdsSyncSetTimeoutEx(port, 3000));
            var local = new AmsAddr { NetId = new byte[6] };
            Check(AdsGetLocalAddressEx(port, ref local));
            string[] idParts = Array.ConvertAll(local.NetId, b => b.ToString());
            Console.WriteLine(json.Serialize(new { ready = true, localAmsNetId = string.Join(".", idParts), localAdsPort = port }));
            string line;
            while ((line = Console.ReadLine()) != null) {
                object id = null;
                try {
                    var request = json.Deserialize<Dictionary<string, object>>(line);
                    id = request["id"];
                    if ((string)request["method"] == "close") {
                        Console.WriteLine(json.Serialize(new { id = id, closed = true }));
                        return 0;
                    }
                    if ((string)request["method"] != "request") throw new ArgumentException("Unknown bridge method");
                    var addr = Address((string)request["netId"], Convert.ToInt32(request["port"]));
                    byte[] payload = Convert.FromBase64String((string)request["payload"]);
                    if (payload.Length > MaxBytes) throw new ArgumentException("ADS payload exceeds 16 MiB");
                    byte[] result = Request(port, addr, Convert.ToInt32(request["command"]), payload);
                    Console.WriteLine(json.Serialize(new { id = id, data = Convert.ToBase64String(result) }));
                } catch (Exception error) {
                    var ads = error as AdsException;
                    Console.WriteLine(json.Serialize(new { id = id, error = error.Message, errorCode = ads == null ? -1 : ads.Code }));
                }
            }
            return 0;
        } catch (Exception error) {
            Console.Error.WriteLine(error.Message);
            return 1;
        } finally { if (port != 0) AdsPortCloseEx(port); }
    }
}
