using Aw.Evidence.Core;
using Aw.Evidence.Core.Guard;
using Aw.Evidence.Testing;

namespace Aw.Evidence.Tests.Guard;

public sealed class ProvenanceAndCredentialsTests
{
    [Theory, Trait("Lane", "unit")]
    [InlineData(HostKind.Preview, null, Provenance.Scrubbed)]
    [InlineData(HostKind.Preview, DbProvenance.Seeded, Provenance.Scrubbed)]
    [InlineData(HostKind.Preview, DbProvenance.Unknown, Provenance.Unknown)]
    [InlineData(HostKind.Local, DbProvenance.Seeded, Provenance.Seeded)]
    [InlineData(HostKind.Local, DbProvenance.Unknown, Provenance.Unknown)]
    [InlineData(HostKind.Local, null, Provenance.Unknown)]
    public void Provenance_combines_the_host_with_the_database_check(HostKind kind, DbProvenance? db, Provenance expected) =>
        Assert.Equal(expected, ProvenanceRules.For(kind, db));

    [Theory, Trait("Lane", "unit")]
    [InlineData("http://localhost:3000", DbProvenance.Seeded)]
    [InlineData("https://pr-1.preview.example.com", DbProvenance.Unknown)]
    public void A_non_local_run_is_never_seeded(string host, DbProvenance expected) =>
        Assert.Equal(expected, ProvenanceRules.Effective(host, DbProvenance.Seeded));

    [Fact, Trait("Lane", "unit")]
    public void Missing_credentials_name_the_variables_and_never_a_value()
    {
        var secrets = new FakeSecrets(new Dictionary<string, string>(StringComparer.Ordinal) { ["APP_EMAIL"] = "a@example.com", ["APP_PASSWORD"] = " " });

        var result = Credentials.Read(secrets, "APP_EMAIL", "APP_PASSWORD");

        Assert.Equal(EvidenceErrors.CredentialsMissing.Code, result.Error.Code);
        Assert.Equal("missing credentials in environment: APP_PASSWORD", result.Error.Message);
    }

    [Fact, Trait("Lane", "unit")]
    public void Credentials_redact_themselves_from_any_text()
    {
        var secrets = new FakeSecrets(new Dictionary<string, string>(StringComparer.Ordinal) { ["E"] = "me@example.com", ["P"] = "hunter2" });
        var credentials = Credentials.Read(secrets, "E", "P").Value;

        Assert.Equal("fill [redacted] then [redacted] failed", credentials.Redact("fill me@example.com then hunter2 failed"));
        Assert.DoesNotContain("hunter2", credentials.ToString(), StringComparison.Ordinal);
    }
}
