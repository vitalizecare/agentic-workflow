using System.Text.Json.Serialization;

namespace Aw.Evidence.Core.Scripts;

/// <summary>A planned UI script: where to go, as whom, which steps, in which viewports.</summary>
/// <param name="Route">The route under test.</param>
/// <param name="Role">The role the run signs in as: the app's own name for it, lower-case kebab-case (recorded, not interpreted).</param>
/// <param name="Steps">The steps, at least one.</param>
/// <param name="Viewports">The viewports, at least one; every step runs in each.</param>
/// <param name="Planning">The planning invocation, when the planner recorded it.</param>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record UiScript(
    string Route,
    string Role,
    IReadOnlyList<ScriptStep> Steps,
    IReadOnlyList<ViewportKind> Viewports,
    PlanningMeta? Planning = null);
