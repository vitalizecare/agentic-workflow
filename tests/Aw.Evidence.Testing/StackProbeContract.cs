using Aw.Evidence.Core;
using Aw.Kernel;
using Xunit;

namespace Aw.Evidence.Testing;

/// <summary>
/// The IStackProbe contract: a page's title reads back, a page without one is AW-EVIDENCE-014, and the database and
/// port checks follow the stack's state (a down service is AW-EVIDENCE-014, never an exception).
/// </summary>
public abstract class StackProbeContract
{
    /// <summary>Arranges a stack in <paramref name="state"/> and returns a probe over it.</summary>
    /// <param name="state">The stack's state.</param>
    /// <returns>The probe and where it looks.</returns>
    protected abstract Task<StackUnderTest> ArrangeAsync(StackState state);

    /// <summary>The login page's title reads back.</summary>
    /// <returns>A task.</returns>
    [Fact]
    public async Task A_page_title_reads_back()
    {
        var stack = await ArrangeAsync(new StackState("Example QA", DatabaseReady: true, PortOpen: true));

        Expect.That((await stack.Probe.PageTitleAsync(stack.LoginPage, CancellationToken.None)).Value == "Example QA", "the title reads back");
    }

    /// <summary>A page without a title is a probe failure.</summary>
    /// <returns>A task.</returns>
    [Fact]
    public async Task A_page_without_a_title_is_a_probe_failure()
    {
        var stack = await ArrangeAsync(new StackState(LoginTitle: null, DatabaseReady: true, PortOpen: true));

        IsProbeFailure(await stack.Probe.PageTitleAsync(stack.LoginPage, CancellationToken.None), "a page without a title");
    }

    /// <summary>The database check follows the database.</summary>
    /// <returns>A task.</returns>
    [Fact]
    public async Task The_database_check_follows_the_database()
    {
        var up = await ArrangeAsync(new StackState("App", DatabaseReady: true, PortOpen: true));
        var down = await ArrangeAsync(new StackState("App", DatabaseReady: false, PortOpen: true));

        Expect.That((await up.Probe.DatabaseReadyAsync(CancellationToken.None)).IsSuccess, "a ready database passes");
        IsProbeFailure(await down.Probe.DatabaseReadyAsync(CancellationToken.None), "a database that isn't ready");
    }

    /// <summary>The port check follows the listener.</summary>
    /// <returns>A task.</returns>
    [Fact]
    public async Task The_port_check_follows_the_listener()
    {
        var open = await ArrangeAsync(new StackState("App", DatabaseReady: true, PortOpen: true));
        var closed = await ArrangeAsync(new StackState("App", DatabaseReady: true, PortOpen: false));

        Expect.That((await open.Probe.PortOpenAsync(open.Host, open.Port, CancellationToken.None)).IsSuccess, "a listening port passes");
        IsProbeFailure(await closed.Probe.PortOpenAsync(closed.Host, closed.Port, CancellationToken.None), "a port nothing listens on");
    }

    private static void IsProbeFailure<T>(Result<T> result, string what) =>
        Expect.That(result.IsError && result.Error.Code == EvidenceErrors.ProbeFailed.Code, $"{what} is AW-EVIDENCE-014");
}
