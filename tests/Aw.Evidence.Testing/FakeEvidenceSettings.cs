using Aw.Evidence.Core.Settings;
using Aw.Evidence.Core.Stack;

namespace Aw.Evidence.Testing;

/// <summary>
/// An IEvidenceSettings holding plain values: an unconfigured install by default (no user agent, the default model and seed
/// policy, no preview host pattern, no API port, no app title).
/// </summary>
public sealed class FakeEvidenceSettings : IEvidenceSettings
{
    /// <inheritdoc/>
    public string? UserAgent { get; set; }

    /// <inheritdoc/>
    public string VisualModel { get; set; } = "judge-default";

    /// <summary>A fictional per-PR preview pattern (pr-&lt;n&gt;.preview.example.com) for tests that drive a preview host.</summary>
    public const string ExamplePreviewHostPattern = "pr-[0-9]+\\.preview\\.example\\.com";

    /// <inheritdoc/>
    public string? PreviewHostPattern { get; set; }

    /// <inheritdoc/>
    public int? ApiPort { get; set; }

    /// <inheritdoc/>
    public SeedPolicy SeedPolicy { get; set; } = SeedPolicy.Default;

    /// <inheritdoc/>
    public string AppTitleSource { get; set; } = "FakeEvidenceSettings.AppTitle";

    /// <summary>The configured app title, or null.</summary>
    public string? AppTitle { get; set; }

    /// <inheritdoc/>
    public ValueTask<string?> AppTitleAsync(CancellationToken cancellationToken) => ValueTask.FromResult(AppTitle);
}
