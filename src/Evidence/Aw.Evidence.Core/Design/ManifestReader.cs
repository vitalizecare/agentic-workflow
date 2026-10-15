using System.Text.Json;
using Aw.Evidence.Core.Scripts;
using Aw.Kernel;

namespace Aw.Evidence.Core.Design;

/// <summary>Reads a design manifest and checks its rules. Unknown keys are refused in every manifest object; a frame's steps use the script step format.</summary>
public static class ManifestReader
{
    /// <summary>Parses and validates a manifest.</summary>
    /// <param name="utf8Json">The manifest file's bytes.</param>
    /// <param name="options">The package's AwJson options.</param>
    /// <returns>The manifest with defaults filled in, or AW-EVIDENCE-003 naming every problem.</returns>
    public static Result<DesignManifest> Read(ReadOnlySpan<byte> utf8Json, JsonSerializerOptions options) =>
        JsonInput.Read<DesignManifest>(utf8Json, options, EvidenceErrors.ManifestInvalid).Bind(Validate);

    /// <summary>Checks a manifest's rules.</summary>
    /// <param name="manifest">The manifest.</param>
    /// <returns>The manifest, or AW-EVIDENCE-003 naming every problem.</returns>
    public static Result<DesignManifest> Validate(DesignManifest manifest)
    {
        var problems = new Problems();
        ManifestRules.CheckManifest(manifest, problems);
        problems.AddIf(manifest.Frames.Any(static f => f is null), "frames holds a null entry");
        foreach (var frame in manifest.Frames.Where(static f => f is not null))
        {
            ManifestRules.CheckFrame(frame, problems);
            foreach (var step in frame.Steps)
            {
                var checkedStep = ScriptReader.Validate(new UiScript("/", "staff", [step], [ViewportKind.Desktop]));
                problems.AddIf(checkedStep.IsError, $"frame \"{frame.Name}\": {(checkedStep.IsError ? checkedStep.Error.Message : string.Empty)}");
            }
        }

        return problems.Into(manifest, EvidenceErrors.ManifestInvalid);
    }
}
