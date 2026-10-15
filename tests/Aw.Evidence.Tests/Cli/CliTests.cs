using System.Text.Json;
using Aw.Evidence.Core.Guard;
using Aw.Evidence.Core.Runs;
using Aw.Evidence.Testing;
using Aw.Kernel.Json;
using Aw.Kernel.Testing;

namespace Aw.Evidence.Tests.Cli;

/// <summary>The ui-evidence CLI end to end: argument errors, guard refusals, exit codes and the lock contract.</summary>
[Lane(TestLane.Integration)]
public sealed class CliTests : IDisposable
{
    private readonly CliWorkspace _work = new();

    public void Dispose() => _work.Dispose();

    private string SaveScript() => _work.Write("script.json", TestJson.Write(A.Script().WithStep(ScriptBuilder.Click("save-button")).Build()));

    [Theory]
    [InlineData]
    [InlineData("frobnicate")]
    [InlineData("run", "script.json")]
    [InlineData("run", "script.json", "run-1", "extra")]
    [InlineData("run", "script.json", "run-1", "--nope")]
    [InlineData("run", "script.json", "run-1", "--host")]
    [InlineData("run", "script.json", "run-1", "--host", "--allow-writes")]
    [InlineData("run", "script.json", "run-1", "--app-build", "a", "--app-build", "b")]
    [InlineData("run", "script.json", "run-1", "--allow-writes", "--allow-writes")]
    [InlineData("run", "script.json", "run-1", "--lock-timeout", "-1")]
    [InlineData("parity", "manifest.json", "run-1", "--db-provenance", "maybe")]
    [InlineData("parity-comment", "run-1", "--for", "gitlab")]
    [InlineData("parity-stale", "--attachments", "a.json")]
    [InlineData("publish-plan", "run-1")]
    [InlineData("doctor", "now")]
    public void A_usage_error_exits_1_with_the_usage_line_and_takes_no_lock(params string[] args)
    {
        var (exit, output, error) = _work.Run(args);

        Assert.Equal((1, ""), (exit, output));
        Assert.StartsWith("ui-evidence: usage: ui-evidence ", error, StringComparison.Ordinal);
        Assert.False(Directory.Exists(_work.QaStackLock));
    }

    [Fact]
    public void A_write_looking_step_on_a_preview_host_is_refused_with_exit_1_before_any_lock()
    {
        var script = SaveScript();

        var (exit, _, error) = _work.Run("run", script, "run-1", "--host", "https://pr-12.preview.example.com", "--allow-preview-host");

        Assert.Equal(1, exit);
        Assert.StartsWith("ui-evidence: AW-EVIDENCE-005 ", error, StringComparison.Ordinal);
        Assert.False(Directory.Exists(_work.QaStackLock));
        Assert.False(Directory.Exists(_work.HeavyJobLock));
    }

    [Theory]
    [InlineData("https://app.preview.example.com")]
    [InlineData("https://pr-12.preview.example.com")]
    [InlineData("http://localhost:3000/login")]
    public void A_host_that_is_not_local_or_an_allowed_preview_is_refused_with_exit_1(string host)
    {
        var (exit, _, error) = _work.Run("run", SaveScript(), "run-1", "--host", host);

        Assert.Equal(1, exit);
        Assert.StartsWith("ui-evidence: AW-EVIDENCE-004 ", error, StringComparison.Ordinal);
        Assert.False(Directory.Exists(_work.QaStackLock));
    }

    [Fact]
    public void A_busy_qa_stack_lock_exits_75_and_leaves_the_holder_alone()
    {
        _ = Directory.CreateDirectory(_work.QaStackLock);
        File.WriteAllText(Path.Combine(_work.QaStackLock, "owner"), "1 2026-10-10T12:00:00Z someone-else\n");

        var (exit, output, error) = _work.Run("run", SaveScript(), "run-1", "--lock-timeout", "0");

        Assert.Equal((75, ""), (exit, output));
        Assert.Contains("ui-evidence: AW-EVIDENCE-009 ", error, StringComparison.Ordinal);
        Assert.Equal("1 2026-10-10T12:00:00Z someone-else\n", File.ReadAllText(Path.Combine(_work.QaStackLock, "owner")));
        Assert.False(Directory.Exists(_work.HeavyJobLock));
    }

    [Fact]
    public void Parity_plan_exits_3_until_every_image_is_reviewed_then_0()
    {
        var summary = A.ParitySummary().WithFrame(ParitySummaryBuilder.Frame() with { Files = ParityFiles.For(Path.Combine(_work.Root, "p1"), "default") }).Build();
        _ = _work.Write("p1/parity.json", TestJson.Write(summary));
        var image = _work.Write("p1/default-side-by-side.png", "png");

        var (blockedExit, blockedOut, _) = _work.Run("parity-plan", "p1");
        var (clearExit, _, _) = _work.Run("parity-plan", "p1", "--reviewed", image);

        Assert.Equal(3, blockedExit);
        using var plan = JsonDocument.Parse(blockedOut);
        Assert.True(plan.RootElement.GetProperty("reviewBlocked").GetBoolean());
        Assert.Equal(image, plan.RootElement.GetProperty("unreviewed")[0].GetString());
        Assert.Equal(0, clearExit);
    }

    [Fact]
    public void Parity_plan_keeps_unknown_provenance_local_with_exit_1()
    {
        _ = _work.Write("p1/parity.json", TestJson.Write(A.ParitySummary().WithProvenance(Provenance.Unknown).Build()));

        var (exit, _, error) = _work.Run("parity-plan", "p1");

        Assert.Equal(1, exit);
        Assert.StartsWith("ui-evidence: AW-EVIDENCE-016 ", error, StringComparison.Ordinal);
    }

    [Fact]
    public void Publish_plan_downgrades_a_non_local_host_to_unknown_provenance()
    {
        _ = _work.Write("r1/summary.json", TestJson.Write(A.RunSummary().OnHost("https://pr-12.preview.example.com").Build()));

        var (exit, output, _) = _work.Run("publish-plan", "r1", "--provenance", "seeded", "--linear-issue", "FRN-1");

        Assert.Equal(0, exit);
        using var plan = JsonDocument.Parse(output);
        Assert.Equal("unknown", plan.RootElement.GetProperty("provenance").GetString());
        Assert.False(plan.RootElement.GetProperty("linearUploadAllowed").GetBoolean());
    }

    [Fact]
    public void Parity_comment_prints_markdown_and_parity_put_prints_an_argv_array()
    {
        _ = _work.Write("p1/parity.json", TestJson.Write(A.ParitySummary().Build()));
        _ = _work.Write("upload.json", """{"url":"https://uploads.example/x","headers":{"Content-Type":"image/png"}}""");

        var (commentExit, comment, _) = _work.Run("parity-comment", "p1", "--for", "github");
        var (putExit, put, _) = _work.Run("parity-put", "--upload", "upload.json", "--file", "a.png");

        Assert.Equal(0, commentExit);
        Assert.StartsWith("## Design parity (seeded data, images on Linear)", comment, StringComparison.Ordinal);
        Assert.Equal(0, putExit);
        Assert.Equal("https://uploads.example/x", AwJson.Deserialize<IReadOnlyList<string>>(TestJson.Utf8(put), TestJson.Options).Value[^1]);
    }

    [Theory]
    [InlineData("TERM")]
    [InlineData("INT")]
    [InlineData("HUP")]
    public void A_signal_while_waiting_on_a_lock_exits_130_and_releases_the_lock_already_taken(string signal)
    {
        _ = Directory.CreateDirectory(_work.HeavyJobLock);   // another holder has the only heavy-job slot
        using var running = _work.Start("run", SaveScript(), "run-1", "--lock-timeout", "30");
        running.WaitForStderr("waiting on lock: " + _work.HeavyJobLock);
        Assert.True(Directory.Exists(_work.QaStackLock), "the QA-stack lock is taken first");

        running.Signal(signal);
        var (exit, output, error) = running.WaitForExit();

        Assert.Equal((130, ""), (exit, output));
        Assert.Contains("ui-evidence: interrupted", error, StringComparison.Ordinal);
        Assert.False(Directory.Exists(_work.QaStackLock), "the QA-stack lock is released on the way out");
        Assert.True(Directory.Exists(_work.HeavyJobLock), "the other holder's lock is left alone");
    }
}
