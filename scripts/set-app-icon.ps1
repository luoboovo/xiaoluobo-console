param([Parameter(Mandatory=$true)][string]$Executable, [Parameter(Mandatory=$true)][string]$Icon)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.ComponentModel;
public static class AppIcon {
  delegate bool Names(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
  delegate bool Languages(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr param);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
  [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr module);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool EnumResourceNames(IntPtr module, IntPtr type, Names callback, IntPtr param);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, Languages callback, IntPtr param);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] bytes, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool EndUpdateResource(IntPtr update, bool discard);
  class Group { public string Name; public ushort Language; public Group(string n, ushort l) { Name=n; Language=l; } }
  static Exception Error() { return new Win32Exception(Marshal.GetLastWin32Error()); }
  static IntPtr Resource(string name) { return name.StartsWith("#") ? new IntPtr(int.Parse(name.Substring(1))) : Marshal.StringToHGlobalUni(name); }
  static void Put(IntPtr update, int type, string name, ushort language, byte[] bytes) {
    IntPtr pointer=Resource(name);
    try { if(!UpdateResource(update,new IntPtr(type),pointer,language,bytes,(uint)bytes.Length))throw Error(); }
    finally { if(!name.StartsWith("#"))Marshal.FreeHGlobal(pointer); }
  }
  public static void Apply(string executable, string icon) {
    byte[] ico=File.ReadAllBytes(icon);var images=new List<byte[]>();byte[] group;
    using(var reader=new BinaryReader(new MemoryStream(ico)))
    using(var data=new MemoryStream())
    using(var writer=new BinaryWriter(data)) {
      if(ico.Length<6 || reader.ReadUInt16()!=0 || reader.ReadUInt16()!=1)throw new InvalidDataException("Invalid ICO header");
      ushort count=reader.ReadUInt16();
      if(count<1 || count>64 || ico.Length<6+16*count)throw new InvalidDataException("Invalid ICO directory");
      writer.Write((ushort)0);writer.Write((ushort)1);writer.Write(count);
      for(int i=0;i<count;i++) {
        byte[] dimensions=reader.ReadBytes(8);uint size=reader.ReadUInt32(),offset=reader.ReadUInt32();
        if(size==0 || offset<6+16*count || (ulong)offset+size>(ulong)ico.Length)throw new InvalidDataException("Invalid ICO image bounds");
        var image=new byte[size];Buffer.BlockCopy(ico,(int)offset,image,0,(int)size);images.Add(image);
        writer.Write(dimensions);writer.Write(size);writer.Write((ushort)(1001+i));
      }
      group=data.ToArray();
    }
    var groups=new List<Group>();IntPtr module=LoadLibraryEx(executable,IntPtr.Zero,2);
    if(module==IntPtr.Zero)throw Error();
    int enumerationError=0;
    try {
      Names names=(m,t,n,p)=>{
        string name=n.ToInt64()<=65535 ? "#"+n.ToInt64() : Marshal.PtrToStringUni(n);
        Languages languages=(lm,lt,ln,l,lp)=>{groups.Add(new Group(name,l));return true;};
        if(!EnumResourceLanguages(m,t,n,languages,IntPtr.Zero)){enumerationError=Marshal.GetLastWin32Error();return false;}return true;
      };
      if(!EnumResourceNames(module,new IntPtr(14),names,IntPtr.Zero) && Marshal.GetLastWin32Error()!=1813)throw Error();
      if(enumerationError!=0)throw new Win32Exception(enumerationError);
    } finally { FreeLibrary(module); }
    if(groups.Count==0)groups.Add(new Group("#1",0));
    IntPtr update=BeginUpdateResource(executable,false);if(update==IntPtr.Zero)throw Error();
    bool completed=false;
    try {
      foreach(var entry in groups) {
        for(int i=0;i<images.Count;i++)Put(update,3,"#"+(1001+i),entry.Language,images[i]);
        Put(update,14,entry.Name,entry.Language,group);
      }
      if(!EndUpdateResource(update,false))throw Error();completed=true;
    } finally { if(!completed)EndUpdateResource(update,true); }
  }
}
'@
[AppIcon]::Apply((Resolve-Path -LiteralPath $Executable).Path, (Resolve-Path -LiteralPath $Icon).Path)
