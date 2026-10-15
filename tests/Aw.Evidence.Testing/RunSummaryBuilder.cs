using System.Globalization;
using Aw.Evidence.Core.Ids;
using Aw.Evidence.Core.Lint;
using Aw.Evidence.Core.Runs;
using Aw.Evidence.Core.Scripts;
using Aw.Evidence.Core.Steps;
using Aw.Evidence.Core.Visual;

namespace Aw.Evidence.Testing;

/// <summary>Builds a <see cref="RunSummary"/> with fixed times and paths under /runs/run-1.</summary>
public sealed class RunSummaryBuilder
{
    private static readonly DateTimeOffset _start = new(2026, 10, 10, 12, 0, 0, TimeSpan.Zero);
    private readonly List<RunStep> _steps = [];
    private readonly List<RunLintFinding> _lint = [];
    private RunVisual _visual = new(Verdict.LooksRight, [], DiffScore: null, DiffImage: null);
    private RunEvidence _evidence = new([], []);
    private string _host = "http://localhost:3000";

    /// <summary>Adds a step.</summary>
    /// <param name="status">Its status.</param>
    /// <param name="target">Its target.</param>
    /// <returns>This builder.</returns>
    public RunSummaryBuilder WithStep(StepStatus status, string target = "save")
    {
        var index = _steps.Count + 1;
        _steps.Add(new(ViewportKind.Desktop, index, StepAction.Click, target, status, string.Create(CultureInfo.InvariantCulture, $"/runs/run-1/desktop-{index}-click.png")));
        return this;
    }

    /// <summary>Sets the visual verdict.</summary>
    /// <param name="visual">The verdict.</param>
    /// <returns>This builder.</returns>
    public RunSummaryBuilder WithVisual(RunVisual visual)
    {
        _visual = visual;
        return this;
    }

    /// <summary>Adds a lint finding.</summary>
    /// <param name="rule">The rule.</param>
    /// <returns>This builder.</returns>
    public RunSummaryBuilder WithLint(LintRule rule)
    {
        _lint.Add(new(ViewportKind.Desktop, rule, "button#a", "detail"));
        return this;
    }

    /// <summary>Sets the evidence.</summary>
    /// <param name="evidence">The evidence.</param>
    /// <returns>This builder.</returns>
    public RunSummaryBuilder WithEvidence(RunEvidence evidence)
    {
        _evidence = evidence;
        return this;
    }

    /// <summary>Sets the host.</summary>
    /// <param name="host">The origin.</param>
    /// <returns>This builder.</returns>
    public RunSummaryBuilder OnHost(string host)
    {
        _host = host;
        return this;
    }

    /// <summary>Builds the summary (one passed step when none were added).</summary>
    /// <returns>The summary.</returns>
    public RunSummary Build()
    {
        if (_steps.Count == 0)
        {
            _ = WithStep(StepStatus.Passed);
        }

        return new(RunSummary.SchemaName, RunId.From("run-1"), RunInstanceId.From("instance-1"), _start, _start.AddSeconds(30), "/hospitals", "manager", _host,
            AppBuild: null, Fixtures: null, new string('a', 64), Pr: null, [ViewportKind.Desktop], [.. _steps], _visual, [.. _lint], [],
            Planning: null, _evidence);
    }
}
