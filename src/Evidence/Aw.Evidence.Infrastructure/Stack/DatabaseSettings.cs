using System.Text.RegularExpressions;

namespace Aw.Evidence.Infrastructure.Stack;

/// <summary>
/// Where the local database runs, for the docker adapters (deployment-specific, so from the environment; blank counts as
/// unset): UI_EVIDENCE_DB_CONTAINER, the container running Postgres (none: doctor skips the database, provenance stays
/// unknown); UI_EVIDENCE_DB_USER (default postgres); UI_EVIDENCE_SEED_TABLE, the [schema.]table whose email column the
/// provenance check reads (anything but a plain identifier counts as unset, since the name is spliced into the SQL).
/// </summary>
/// <param name="Container">The Postgres container, or null.</param>
/// <param name="User">The database user.</param>
/// <param name="SeedTable">The table with the user emails, or null.</param>
internal sealed partial record DatabaseSettings(string? Container, string User, string? SeedTable)
{
    internal const string ContainerVariable = "UI_EVIDENCE_DB_CONTAINER";
    internal const string UserVariable = "UI_EVIDENCE_DB_USER";
    internal const string SeedTableVariable = "UI_EVIDENCE_SEED_TABLE";
    internal const string DefaultUser = "postgres";

    internal static DatabaseSettings Read(Func<string, string?> environment) =>
        new(
            Set(environment(ContainerVariable)),
            Set(environment(UserVariable)) ?? DefaultUser,
            Set(environment(SeedTableVariable)) is { } table && TableName.IsMatch(table) ? table : null);

    private static string? Set(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    [GeneratedRegex("^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)?\\z", RegexOptions.CultureInvariant | RegexOptions.ExplicitCapture, matchTimeoutMilliseconds: 100)]
    private static partial Regex TableName { get; }
}
