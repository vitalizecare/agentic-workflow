using System.Globalization;
using Aw.Evidence.Core.Stack;
using Aw.Evidence.Infrastructure.Stack;
using Aw.Evidence.Testing;
using Aw.Kernel.Testing;

namespace Aw.Evidence.Tests.Infrastructure;

/// <summary>
/// The psql adapter against a stub docker that plays psql -At over a rows file: it prints each row (NULL as an empty
/// line, as psql does), filtered by the pattern variable's LIKE (with '%' as the only wildcard) when one is passed.
/// </summary>
[Lane(TestLane.Integration)]
public sealed class DockerPsqlProvenanceContractTests : ProvenanceQueryContract, IDisposable
{
    private const string Psql =
        "pattern=\"\"\n" +
        "for arg in \"$@\"; do case \"$arg\" in pattern=*) pattern=\"${arg#pattern=}\" ;; esac; done\n" +
        "cat > /dev/null\n" +
        "glob=\"${pattern//%/*}\"\n" +
        "while IFS= read -r row || [ -n \"$row\" ]; do\n" +
        "  if [ -z \"$pattern\" ]; then printf '%s\\n' \"$row\"; else case \"$row\" in $glob) printf '%s\\n' \"$row\" ;; esac; fi\n" +
        "done < \"$ROWS\"\n";

    private static readonly DatabaseSettings _db = new(Container: "db", User: "postgres", SeedTable: "public.users");

    private readonly TempDirectory _root = new();
    private int _stubs;

    protected override IProvenanceQuery Create(IReadOnlyList<string> emails)
    {
        var n = (++_stubs).ToString(CultureInfo.InvariantCulture);
        var rows = _root.Combine("rows-" + n);
        File.WriteAllText(rows, string.Join('\n', emails) + "\n");
        return new DockerPsqlProvenance(StubCommand.Write(_root, "docker-" + n, "ROWS='" + rows + "'\n" + Psql), _db);
    }

    protected override IProvenanceQuery CreateFailing(string message) =>
        new DockerPsqlProvenance(StubCommand.Write(_root, "docker-failing", $"cat > /dev/null; echo 'ERROR:  {message.Replace("'", "'\\''", StringComparison.Ordinal)}' >&2; exit 3"), _db);

    public void Dispose() => _root.Dispose();
}
