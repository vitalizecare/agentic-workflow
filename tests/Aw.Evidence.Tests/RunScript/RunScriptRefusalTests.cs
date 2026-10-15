using Aw.Evidence.Core;
using Aw.Evidence.Core.Browser;
using Aw.Evidence.Core.Ids;
using Aw.Evidence.Core.Judging;
using Aw.Evidence.Core.Locks;
using Aw.Evidence.Core.Steps;
using Aw.Evidence.Testing;
using Aw.Kernel;

namespace Aw.Evidence.Tests.RunScript;

public sealed class RunScriptRefusalTests
{
    private static RunScriptHarness WithSave()
    {
        var harness = new RunScriptHarness();
        _ = harness.WithScript(A.Script().WithStep(ScriptBuilder.Click("save-button")).Build());
        return harness;
    }

    [Fact, Trait("Lane", "unit")]
    public async Task RunScript_refuses_a_write_looking_step_on_a_preview_host_before_taking_a_lock()
    {
        var harness = WithSave();

        var result = await harness.Run(A.RunScriptRequest().OnHost("https://pr-12.preview.example.com").Build());

        Assert.Equal(EvidenceErrors.StepsRefused.Code, result.Error.Code);
        Assert.Empty(harness.Locks.Events);
        Assert.Empty(harness.Browser.Sessions);
    }

    [Fact, Trait("Lane", "unit")]
    public async Task RunScript_runs_write_looking_steps_on_a_preview_host_when_writes_are_allowed()
    {
        var harness = WithSave();
        _ = harness.Page.TestIds.Add("save-button");

        var result = await harness.Run(A.RunScriptRequest().OnHost("https://pr-12.preview.example.com", allowWrites: true).Build());

        Assert.Equal("https://pr-12.preview.example.com", result.Value.Summary.Host);
    }

    [Fact, Trait("Lane", "unit")]
    public async Task RunScript_never_repairs_a_broken_click_onto_a_write_control_on_a_preview_host()
    {
        var harness = new RunScriptHarness { Judge = new FakeJudge().Repairs(new SelectorRepair(RepairDecision.Repaired, 0, Usage: null), new SelectorRepair(RepairDecision.Repaired, 0, Usage: null)) };
        _ = harness.WithScript(A.Script().WithStep(ScriptBuilder.Click("open-menu")).Build());
        harness.Page.Candidates.Add(new Candidate(0, "button", "Delete account", TestId.From("delete-account"), "Delete account"));
        harness.Page.OnClick["candidate:0"] = static page => page.Texts.Add("Done");

        var result = await harness.Run(A.RunScriptRequest().OnHost("https://pr-12.preview.example.com").Build());

        Assert.Equal(StepStatus.Broken, Assert.Single(result.Value.Summary.Steps).Status);
        Assert.DoesNotContain(harness.Browser.Sessions.SelectMany(static s => s.Calls), static c => c.StartsWith("click candidate", StringComparison.Ordinal));
    }

    [Fact, Trait("Lane", "unit")]
    public async Task RunScript_refuses_a_missing_baseline_before_taking_a_lock()
    {
        var harness = WithSave();

        var result = await harness.Run(A.RunScriptRequest().WithBaseline("/baselines/typo.png").Build());

        Assert.Equal(EvidenceErrors.FileNotFound.Code, result.Error.Code);
        Assert.Contains("--baseline /baselines/typo.png", result.Error.Message, StringComparison.Ordinal);
        Assert.Empty(harness.Locks.Events);
        Assert.Empty(harness.Browser.Sessions);
    }

    [Fact, Trait("Lane", "unit")]
    public async Task RunScript_refuses_a_host_that_is_not_local_or_a_preview()
    {
        var harness = WithSave();

        var result = await harness.Run(A.RunScriptRequest().OnHost("https://app.preview.example.com").Build());

        Assert.Equal(EvidenceErrors.HostRefused.Code, result.Error.Code);
        Assert.Empty(harness.Locks.Events);
    }

    [Fact, Trait("Lane", "unit")]
    public async Task RunScript_names_the_script_file_and_the_json_location_of_a_bad_script()
    {
        var harness = new RunScriptHarness();
        _ = harness.Files.With(RunScriptRequestBuilder.ScriptPath, """{"route":"/","role":"manager","viewports":["desktop"],"steps":[{"action":"goto","target":"/"}]}"""u8.ToArray());

        var result = await harness.Run(A.RunScriptRequest().Build());

        Assert.Equal("script /work/script.json: $.steps[0]: missing required property \"expectedState\"", result.Error.Message);
    }

    [Fact, Trait("Lane", "unit")]
    public async Task RunScript_refuses_a_misspelt_step_key_naming_the_file_and_the_key()
    {
        var harness = new RunScriptHarness();
        _ = harness.Files.With(RunScriptRequestBuilder.ScriptPath, """{"route":"/","role":"manager","viewports":["desktop"],"steps":[{"action":"fill","target":"search","vaule":"St","expectedState":{"kind":"input-value","testId":"search","value":"St"}}]}"""u8.ToArray());

        var result = await harness.Run(A.RunScriptRequest().Build());

        Assert.Equal("script /work/script.json: $.steps[0].vaule: unknown property", result.Error.Message);
        Assert.Empty(harness.Locks.Events);
    }

    [Fact, Trait("Lane", "unit")]
    public async Task RunScript_refuses_a_malformed_script_before_taking_a_lock()
    {
        var harness = new RunScriptHarness();
        _ = harness.Files.With(RunScriptRequestBuilder.ScriptPath, "{\"route\":"u8.ToArray());

        var result = await harness.Run(A.RunScriptRequest().Build());

        Assert.Equal(EvidenceErrors.ScriptInvalid.Code, result.Error.Code);
        Assert.Empty(harness.Locks.Events);
    }

    [Fact, Trait("Lane", "unit")]
    public async Task RunScript_is_lock_busy_without_opening_a_browser_and_leaves_nothing_held()
    {
        var harness = WithSave();
        _ = harness.Locks.AlwaysBusy.Add(LockKind.HeavyJob);

        var result = await harness.Run(A.RunScriptRequest().Build());

        Assert.Equal((EvidenceErrors.LockBusy.Code, ErrorKind.Timeout), (result.Error.Code, result.Error.Kind));
        Assert.Empty(harness.Browser.Sessions);
        Assert.False(harness.Locks.IsHeld(LockKind.QaStack));
    }

    [Fact, Trait("Lane", "unit")]
    public async Task RunScript_releases_the_locks_when_the_browser_fails_to_start()
    {
        var harness = WithSave();
        harness.Browser.FailsToStart = true;

        var result = await harness.Run(A.RunScriptRequest().Build());

        Assert.Equal(ErrorKind.Unavailable, result.Error.Kind);
        Assert.False(harness.Locks.IsHeld(LockKind.QaStack));
        Assert.False(harness.Locks.IsHeld(LockKind.HeavyJob));
        Assert.False(harness.Files.Files.ContainsKey("/runs/run-1/summary.json"));
    }

    [Theory, Trait("Lane", "unit")]
    [InlineData("work/script.json", "/runs/run-1")]
    [InlineData("/work/script.json", "runs/run-1")]
    [InlineData("/work/script.json", "/")]
    public async Task RunScript_needs_absolute_paths_and_a_named_run_directory(string script, string runDirectory)
    {
        var harness = WithSave();

        var result = await harness.Run(A.RunScriptRequest().Build() with { ScriptPath = script, RunDirectory = runDirectory });

        Assert.Equal(EvidenceErrors.Invalid.Code, result.Error.Code);
    }

    [Fact, Trait("Lane", "unit")]
    public async Task RunScript_releases_both_locks_in_reverse_order_when_the_run_throws()
    {
        var harness = WithSave();
        _ = harness.Page.TestIds.Add("save-button");
        harness.Page.ScreenshotThrows = new InvalidOperationException("the browser crashed");

        _ = await Assert.ThrowsAsync<InvalidOperationException>(async () => await harness.Run(A.RunScriptRequest().Build()));

        Assert.Equal(["acquire QaStack", "acquire HeavyJob", "release HeavyJob", "release QaStack"], harness.Locks.Events);
        Assert.False(harness.Locks.IsHeld(LockKind.QaStack));
        Assert.False(harness.Locks.IsHeld(LockKind.HeavyJob));
    }

    [Fact, Trait("Lane", "unit")]
    public async Task RunScript_releases_both_locks_in_reverse_order_when_cancelled_mid_run()
    {
        using var cancel = new CancellationTokenSource();
        var harness = WithSave();
        _ = harness.Page.TestIds.Add("save-button");
        harness.Page.OnClick["testId:save-button"] = _ => cancel.Cancel();   // Ctrl-C arrives while a step runs

        _ = await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await harness.Interruptible(A.RunScriptRequest().Build(), cancel.Token));

        Assert.Equal(["acquire QaStack", "acquire HeavyJob", "release HeavyJob", "release QaStack"], harness.Locks.Events);
        Assert.False(harness.Locks.IsHeld(LockKind.QaStack));
        Assert.False(harness.Locks.IsHeld(LockKind.HeavyJob));
    }

    [Fact, Trait("Lane", "unit")]
    public async Task RunScript_deletes_an_earlier_summary_so_a_run_that_errors_leaves_none()
    {
        var harness = WithSave();
        _ = harness.Files.With(RunScriptRequestBuilder.RunDirectory + "/summary.json", "{\"schema\":\"ui-evidence.run/1\"}"u8.ToArray());
        harness.Browser.FailsToStart = true;

        var result = await harness.Run(A.RunScriptRequest().Build());

        Assert.Equal(ErrorKind.Unavailable, result.Error.Kind);
        Assert.False(harness.Files.Files.ContainsKey(RunScriptRequestBuilder.RunDirectory + "/summary.json"), "exit 4 leaves no earlier evidence behind");
    }
}
