using Aw.Evidence.Core.Guard;
using Aw.Evidence.Core.Lint;
using Aw.Evidence.Core.Publishing;
using Aw.Evidence.Core.Runs;
using Aw.Evidence.Core.Steps;
using Aw.Evidence.Core.Visual;
using Aw.Evidence.Testing;

namespace Aw.Evidence.Tests.Publishing;

public sealed class RunPublishingTests
{
    private static readonly Dictionary<string, string> _noUrls = new(StringComparer.Ordinal);

    [Fact, Trait("Lane", "unit")]
    public void A_clean_run_renders_without_a_warning_flag()
    {
        var comment = EvidenceComment.Render(A.RunSummary().Build(), note: null, _noUrls);

        Assert.Equal(
            "## UI evidence — visual: looks-right\n\n| Step | Status | Screenshot |\n|---|---|---|\n| desktop: click save | passed | /runs/run-1/desktop-1-click.png |",
            comment);
    }

    [Theory, Trait("Lane", "unit")]
    [InlineData(Verdict.Unchecked, StepStatus.Passed, false, true)]
    [InlineData(Verdict.LooksOff, StepStatus.Passed, false, true)]
    [InlineData(Verdict.Sloppy, StepStatus.Passed, false, true)]
    [InlineData(Verdict.Unchanged, StepStatus.Passed, false, false)]
    [InlineData(Verdict.LooksRight, StepStatus.Broken, false, true)]
    [InlineData(Verdict.LooksRight, StepStatus.Passed, true, true)]
    public void Anything_unclear_failed_or_linted_is_flagged_for_a_look(Verdict verdict, StepStatus status, bool lint, bool flagged)
    {
        var builder = A.RunSummary().WithVisual(new RunVisual(verdict, [], DiffScore: null, DiffImage: null)).WithStep(status);
        var summary = (lint ? builder.WithLint(LintRule.Overlap) : builder).Build();

        Assert.Equal(flagged, EvidenceComment.Render(summary, note: null, _noUrls).Split('\n')[0].EndsWith(" ⚠", StringComparison.Ordinal));
    }

    [Fact, Trait("Lane", "unit")]
    public void The_comment_carries_the_diff_reasons_evidence_and_note_with_uploaded_urls()
    {
        var summary = A.RunSummary()
            .WithVisual(new RunVisual(Verdict.LooksOff, ["overlap", "cut label"], 0.0123, "/runs/run-1/visual-diff.png"))
            .WithEvidence(new RunEvidence(["/runs/run-1/desktop-trace.zip"], ["/runs/run-1/v.webm"]))
            .Build();
        var urls = new Dictionary<string, string>(StringComparer.Ordinal) { ["/runs/run-1/desktop-1-click.png"] = "https://cdn.example/1.png" };

        var lines = EvidenceComment.Render(summary, "Linear upload failed — local paths only.", urls).Split('\n');

        Assert.Contains("| desktop: click save | passed | https://cdn.example/1.png |", lines, StringComparer.Ordinal);
        Assert.Contains("Baseline diff: 1.230% of pixels", lines, StringComparer.Ordinal);
        Assert.Contains("Visual reasons: overlap; cut label", lines, StringComparer.Ordinal);
        Assert.Equal(["Evidence:", "- /runs/run-1/desktop-trace.zip", "- /runs/run-1/v.webm", "- /runs/run-1/visual-diff.png", "", "Linear upload failed — local paths only."], lines[^6..]);
    }

    [Fact, Trait("Lane", "unit")]
    public void A_seeded_local_run_may_go_to_a_named_linear_issue()
    {
        var plan = RunPublishing.Plan(A.RunSummary().Build(), DbProvenance.Seeded, hasLinearIssue: true);

        Assert.Equal(DbProvenance.Seeded, plan.Provenance);
        Assert.True(plan.LinearUploadAllowed);
        Assert.Null(plan.Note);
        Assert.Equal("Publish UI evidence for run run-1? DB provenance: seeded (Linear upload allowed).", plan.Question);
        Assert.Equal(["/runs/run-1/desktop-1-click.png"], plan.Files);
    }

    [Theory, Trait("Lane", "unit")]
    [InlineData("https://pr-4.preview.example.com", DbProvenance.Seeded, true)]
    [InlineData("http://localhost:3000", DbProvenance.Unknown, true)]
    [InlineData("http://localhost:3000", DbProvenance.Seeded, false)]
    public void Unknown_provenance_keeps_the_evidence_local_whatever_the_answer(string host, DbProvenance claimed, bool staysLocal)
    {
        var plan = RunPublishing.Plan(A.RunSummary().OnHost(host).Build(), claimed, hasLinearIssue: true);

        Assert.Equal(staysLocal, !plan.LinearUploadAllowed);
        Assert.Equal(staysLocal, plan.PrComment.EndsWith("DB provenance unknown — evidence kept local only, not uploaded to Linear.", StringComparison.Ordinal));
    }

    [Fact, Trait("Lane", "unit")]
    public void Without_a_linear_issue_nothing_is_uploaded_and_the_question_says_so()
    {
        var plan = RunPublishing.Plan(A.RunSummary().Build(), DbProvenance.Seeded, hasLinearIssue: false);

        Assert.False(plan.LinearUploadAllowed);
        Assert.Equal("Publish UI evidence for run run-1? DB provenance: seeded, but no Linear issue was given (no Linear upload).", plan.Question);
    }
}
