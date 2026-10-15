using Aw.Evidence.Core.Ids;
using Aw.Evidence.Core.Scripts;

namespace Aw.Evidence.Testing;

/// <summary>Builds a <see cref="UiScript"/>.</summary>
public sealed class ScriptBuilder
{
    private readonly List<ScriptStep> _steps = [];
    private ViewportKind[] _viewports = [ViewportKind.Desktop];
    private PlanningMeta? _planning;

    /// <summary>A goto step expecting the URL path to match.</summary>
    /// <param name="path">The path.</param>
    /// <returns>The step.</returns>
    public static ScriptStep Goto(string path) => new(StepAction.Goto, path, new UrlPath(path.Split('?')[0]));

    /// <summary>A click step.</summary>
    /// <param name="testId">The target test id.</param>
    /// <param name="expected">The expected state (default: the text 'Done' visible).</param>
    /// <returns>The step.</returns>
    public static ScriptStep Click(string testId, ExpectedState? expected = null) =>
        new(StepAction.Click, testId, expected ?? new TextVisible("Done"));

    /// <summary>A fill step expecting the input to hold the value.</summary>
    /// <param name="testId">The target test id.</param>
    /// <param name="value">The value.</param>
    /// <returns>The step.</returns>
    public static ScriptStep Fill(string testId, string value) =>
        new(StepAction.Fill, testId, new InputValue(TestId.From(testId), value), value);

    /// <summary>Adds a step.</summary>
    /// <param name="step">The step.</param>
    /// <returns>This builder.</returns>
    public ScriptBuilder WithStep(ScriptStep step)
    {
        _steps.Add(step);
        return this;
    }

    /// <summary>Sets the viewports.</summary>
    /// <param name="viewports">The viewports.</param>
    /// <returns>This builder.</returns>
    public ScriptBuilder In(params ViewportKind[] viewports)
    {
        _viewports = viewports;
        return this;
    }

    /// <summary>Sets the planning block.</summary>
    /// <param name="planning">The block.</param>
    /// <returns>This builder.</returns>
    public ScriptBuilder WithPlanning(PlanningMeta planning)
    {
        _planning = planning;
        return this;
    }

    /// <summary>Builds the script (one goto step when none were added).</summary>
    /// <returns>The script.</returns>
    public UiScript Build() => new("/hospitals", "manager", _steps.Count > 0 ? [.. _steps] : [Goto("/hospitals")], _viewports, _planning);
}
