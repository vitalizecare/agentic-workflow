using Aw.Evidence.Core;
using Aw.Evidence.Core.Guard;
using Aw.Evidence.Core.Scripts;
using Aw.Evidence.Testing;

namespace Aw.Evidence.Tests.Guard;

public sealed class StepGuardTests
{
    private static readonly ResolvedHost _preview = new("https://pr-9.preview.example.com", HostKind.Preview);
    private static readonly ResolvedHost _local = new("http://localhost:4000", HostKind.Local);

    private static ScriptStep Click(string target) => ScriptBuilder.Click(target);

    [Fact, Trait("Lane", "unit")]
    public void Click_on_a_save_button_is_refused_under_a_host_override()
    {
        var result = StepGuard.ForRun([ScriptBuilder.Goto("/x"), Click("save-button")], _preview, allowWrites: false);

        Assert.Equal(EvidenceErrors.StepsRefused.Code, result.Error.Code);
        Assert.Contains("#2 click save-button", result.Error.Message, StringComparison.Ordinal);
    }

    [Fact, Trait("Lane", "unit")]
    public void Allow_writes_lets_a_save_click_run_on_a_preview() =>
        Assert.True(StepGuard.ForRun([Click("save")], _preview, allowWrites: true).IsSuccess);

    [Theory, Trait("Lane", "unit")]
    [InlineData("http://localhost:3000")]
    [InlineData("http://localhost:4000")]
    public void A_local_stack_is_never_write_guarded_for_a_run(string origin) =>
        Assert.True(StepGuard.ForRun([Click("delete")], new ResolvedHost(origin, HostKind.Local), allowWrites: false).IsSuccess);

    [Theory, Trait("Lane", "unit")]
    [InlineData("save")]
    [InlineData("deleteBtn")]
    [InlineData("savebutton")]
    [InlineData("updateHospital-btn")]
    [InlineData("confirm_dialog")]
    [InlineData("user-logout-link")]
    [InlineData("archiveaction")]
    public void Write_looking_click_targets_are_refused(string target) =>
        Assert.True(StepGuard.ForRun([Click(target)], _preview, allowWrites: false).IsError);

    [Theory, Trait("Lane", "unit")]
    [InlineData("open-panel")]
    [InlineData("saved-filters")]
    [InlineData("hospital-name")]
    [InlineData("addressLine")]
    public void Read_only_click_targets_pass(string target) =>
        Assert.True(StepGuard.ForRun([Click(target)], _preview, allowWrites: false).IsSuccess);

    [Theory, Trait("Lane", "unit")]
    [InlineData("/users/delete", false)]
    [InlineData("/reports?export=delete", true)]
    [InlineData("/hospitals", true)]
    public void A_goto_path_is_judged_by_its_path_not_its_query(string path, bool passes) =>
        Assert.Equal(passes, StepGuard.ForRun([ScriptBuilder.Goto(path)], _preview, allowWrites: false).IsSuccess);

    [Fact, Trait("Lane", "unit")]
    public void A_fill_is_never_a_write() =>
        Assert.True(StepGuard.ForRun([ScriptBuilder.Fill("save-name", "x")], _preview, allowWrites: false).IsSuccess);

    [Theory, Trait("Lane", "unit")]
    [InlineData("//evil.example/x")]
    [InlineData("@evil.example/x")]
    [InlineData("https://evil.example")]
    [InlineData("/a\\b")]
    public void A_goto_leaving_the_host_is_refused_even_locally_and_with_allow_writes(string target)
    {
        var step = new ScriptStep(StepAction.Goto, target, new UrlPath("/"));

        var result = StepGuard.ForRun([step], _local, allowWrites: true);

        Assert.Equal(EvidenceErrors.StepsRefused.Code, result.Error.Code);
        Assert.Contains("must be paths on the host", result.Error.Message, StringComparison.Ordinal);
    }

    [Fact, Trait("Lane", "unit")]
    public void Parity_steps_are_read_only_on_every_host()
    {
        Assert.True(StepGuard.ForParity([Click("submit")], allowWrites: false).IsError);
        Assert.True(StepGuard.ForParity([Click("submit")], allowWrites: true).IsSuccess);
    }
}
