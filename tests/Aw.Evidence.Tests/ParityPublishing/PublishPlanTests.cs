using Aw.Evidence.Core.Guard;
using Aw.Evidence.Features.PublishPlan;
using Aw.Evidence.Testing;
using Aw.Kernel.Json;

namespace Aw.Evidence.Tests.ParityPublishing;

public sealed class PublishPlanTests
{
    private static async Task<Core.Publishing.RunPublishPlan> Plan(string host, DbProvenance claimed)
    {
        var files = new InMemoryRunFiles().With("/runs/run-1/summary.json", AwJson.Serialize(A.RunSummary().OnHost(host).Build(), TestJson.Options));
        var result = await new PublishPlanService(files, TestJson.Options).Handle(new("/runs/run-1", claimed, "FRN-1"), CancellationToken.None);
        return result.Value.Plan;
    }

    [Fact, Trait("Lane", "unit")]
    public async Task PublishPlan_allows_a_linear_upload_for_a_seeded_local_run()
    {
        var plan = await Plan("http://localhost:3000", DbProvenance.Seeded);

        Assert.Equal((DbProvenance.Seeded, true), (plan.Provenance, plan.LinearUploadAllowed));
    }

    [Fact, Trait("Lane", "unit")]
    public async Task PublishPlan_downgrades_a_non_local_host_to_unknown_provenance()
    {
        var plan = await Plan("https://pr-7.preview.example.com", DbProvenance.Seeded);

        Assert.Equal((DbProvenance.Unknown, false), (plan.Provenance, plan.LinearUploadAllowed));
        Assert.Contains("evidence stays local", plan.Question, StringComparison.Ordinal);
    }
}
