using Aw.Evidence.Core.Design;
using Aw.Evidence.Core.Geometry;
using Aw.Evidence.Core.Images;
using Aw.Evidence.Core.Steps;
using Aw.Evidence.Features.Parity;
using Aw.Evidence.Testing;
using Aw.Kernel;
using Aw.Kernel.Json;
using Aw.Kernel.Services;
using Microsoft.Extensions.Time.Testing;

namespace Aw.Evidence.Tests.Parity;

/// <summary>
/// The parity slice over in-memory fakes. The page is 40x40 white with the 'card' anchor at (5,5) 10x10 and the ready
/// text 'Hospitals'; the design export is a 10x10 white image, so a default run matches pixel for pixel.
/// </summary>
internal sealed class ParityHarness
{
    public const string ManifestPath = "/work/manifest.json";
    public const string RunDirectory = "/runs/parity-1";

    public ParityHarness()
    {
        Browser.PageFor = _ => Page;
        _ = Page.Texts.Add("Hospitals");
        Page.Boxes["testId:card"] = new Box(5, 5, 10, 10);
        Page.Screenshot = Codec.Encode(RgbaImage.Filled(40, 40, 0xFFFFFFFF));
        _ = Files.With("/designs/default.png", Codec.Encode(RgbaImage.Filled(10, 10, 0xFFFFFFFF)));
    }

    public FakePage Page { get; } = new();

    public FakeBrowser Browser { get; } = new();

    public InMemoryRunFiles Files { get; } = new();

    public InMemoryMachineLocks Locks { get; } = new();

    public FakeImageCodec Codec { get; } = new();

    public Dictionary<string, string> Secrets { get; } = new(StringComparer.Ordinal);

    public FakeEvidenceSettings Settings { get; } = new() { PreviewHostPattern = FakeEvidenceSettings.ExamplePreviewHostPattern };

    public static ParityRequest Request() => new(ManifestPath, RunDirectory, TimeSpan.Zero);

    public static DesignManifest Manifest(params DesignFrame[] frames) =>
        (frames.Length == 0 ? A.Manifest() : frames.Aggregate(A.Manifest(), static (m, f) => m.WithFrame(f))).Build() with { Viewport = new ViewportSize(40, 40) };

    public ParityHarness WithManifest(DesignManifest manifest)
    {
        _ = Files.With(ManifestPath, AwJson.Serialize(manifest, TestJson.Options));
        return this;
    }

    public ValueTask<Result<ParityResponse>> Run(ParityRequest request) => Interruptible(request, CancellationToken.None);

    /// <summary>Runs with a token the test cancels (Ctrl-C mid-run).</summary>
    public ValueTask<Result<ParityResponse>> Interruptible(ParityRequest request, CancellationToken interrupt)
    {
        var json = TestJson.Options;
        var secrets = new FakeSecrets(Secrets);
        var capture = new FrameCapture(new StepRunner(FakeJudge.Unavailable, new FakeTimeProvider()), new FrameComparison(Files, Codec));
        var service = new ValidatingService<ParityRequest, ParityResponse>(
            new ParityService(new ParityFilesAccess(Files, json), Locks, secrets, new ParityRun(Browser, capture, Settings), Settings), new ParityValidator());
        return service.Handle(request, interrupt);
    }
}
