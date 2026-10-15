using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Aw.Evidence.Tests.Cli;

/// <summary>
/// A temp directory with its own state root and lock paths, and the built ui-evidence to run against them. The child's
/// environment is pinned: its own lock paths, one heavy-job slot, no inherited heavy-job lease and no UI_EVIDENCE_* or
/// AW_VISUAL_MODEL setting from the developer's shell. Every run is bounded (<see cref="Limit"/>) and killed past it.
/// </summary>
internal sealed class CliWorkspace : IDisposable
{
    /// <summary>The longest a child may run before the test kills it and fails.</summary>
    internal static readonly TimeSpan Limit = TimeSpan.FromSeconds(30);

    private readonly DirectoryInfo _root = Directory.CreateTempSubdirectory("aw-evidence-cli-");

    public string Root => _root.FullName;

    public string QaStackLock => Path.Combine(Root, "locks", "qa-stack.lock");

    public string HeavyJobLock => Path.Combine(Root, "locks", "heavy-job.lock");

    public string Write(string relative, string content)
    {
        var path = Path.Combine(Root, relative);
        _ = Directory.CreateDirectory(Path.GetDirectoryName(path)!);   // why: a path under the root always has a directory
        File.WriteAllText(path, content);
        return path;
    }

    /// <summary>Runs ui-evidence to completion (at most <see cref="Limit"/>).</summary>
    public (int Exit, string Out, string Err) Run(params string[] args)
    {
        using var running = Start(args);
        return running.WaitForExit();
    }

    /// <summary>Runs ui-evidence to completion (at most <see cref="Limit"/>) with extra environment variables.</summary>
    public (int Exit, string Out, string Err) RunWith(IReadOnlyDictionary<string, string> environment, params string[] args)
    {
        using var running = Start(environment, args);
        return running.WaitForExit();
    }

    /// <summary>Starts ui-evidence and returns while it runs, so a test can wait on its stderr and signal it.</summary>
    public RunningCli Start(params string[] args) => Start(new Dictionary<string, string>(StringComparer.Ordinal), args);

    private RunningCli Start(IReadOnlyDictionary<string, string> environment, string[] args)
    {
        var start = new ProcessStartInfo(DotnetHost())
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            WorkingDirectory = Root,
        };
        foreach (var arg in (string[])["exec", Path.Combine(AppContext.BaseDirectory, "ui-evidence.dll"), .. args])
        {
            start.ArgumentList.Add(arg);
        }

        foreach (var name in start.Environment.Keys.Where(static k => k.StartsWith("UI_EVIDENCE_", StringComparison.Ordinal)).ToList())
        {
            _ = start.Environment.Remove(name);
        }

        start.Environment["UI_EVIDENCE_PREVIEW_HOST_PATTERN"] = "pr-[0-9]+\\.preview\\.example\\.com";   // a fictional preview domain
        _ = start.Environment.Remove("AW_HEAVY_LOCK_HELD");
        _ = start.Environment.Remove("AW_VISUAL_MODEL");
        start.Environment["AW_STATE_DIR"] = Path.Combine(Root, "state");
        start.Environment["AW_QA_STACK_LOCK"] = QaStackLock;
        start.Environment["AW_HEAVY_JOB_LOCK"] = HeavyJobLock;
        start.Environment["AW_HEAVY_SLOTS"] = "1";   // one slot, so a test can make the heavy-job lock busy with one directory
        start.Environment["AW_LOG_LEVEL"] = "none";   // the tests compare stderr
        foreach (var (name, value) in environment)
        {
            start.Environment[name] = value;
        }

        return new RunningCli(Process.Start(start)!);   // why: Process.Start returns null only for a shell-executed document
    }

    public void Dispose() => _root.Delete(recursive: true);

    private static string DotnetHost()
    {
        // The runtime directory is <dotnet root>/shared/Microsoft.NETCore.App/<version>/.
        var root = Path.GetFullPath(Path.Combine(RuntimeEnvironment.GetRuntimeDirectory(), "..", "..", ".."));
        return Path.Combine(root, OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet");
    }
}
