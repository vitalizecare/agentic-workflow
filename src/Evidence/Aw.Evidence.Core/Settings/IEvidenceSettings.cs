using Aw.Evidence.Core.Stack;

namespace Aw.Evidence.Core.Settings;

/// <summary>
/// The deployment settings the use cases read, typed: where they come from (the environment, a local env file) and
/// their defaults are the adapter's business. Sign-in credentials, which the manifest names, come from
/// <see cref="Guard.ISecretsSource"/> instead.
/// </summary>
public interface IEvidenceSettings
{
    /// <summary>The user agent the browser presents instead of desktop Chrome at its build, or null for that default.</summary>
    public string? UserAgent { get; }

    /// <summary>The model label in the verdict-cache key.</summary>
    public string VisualModel { get; }

    /// <summary>
    /// The regex a preview --host's whole hostname must match (deployment-specific, e.g. per-PR preview hosts), or null
    /// when none is configured: then every non-loopback host is refused.
    /// </summary>
    public string? PreviewHostPattern { get; }

    /// <summary>A localhost port (an API server) doctor must reach, or null to skip that check.</summary>
    public int? ApiPort { get; }

    /// <summary>What counts as seed data in the local database (fails closed when unconfigured).</summary>
    public SeedPolicy SeedPolicy { get; }

    /// <summary>Where the app title is configured, named for a person fixing a doctor failure.</summary>
    public string AppTitleSource { get; }

    /// <summary>The title the local app must show at /login, or null when it isn't configured.</summary>
    /// <param name="cancellationToken">Cancels a read of the configuration.</param>
    /// <returns>The title, or null.</returns>
    public ValueTask<string?> AppTitleAsync(CancellationToken cancellationToken);
}
