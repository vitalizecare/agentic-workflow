using Aw.Evidence.Core;
using Aw.Evidence.Core.Guard;

namespace Aw.Evidence.Tests.Guard;

public sealed class HostGuardTests
{
    private const string Pattern = "pr-[0-9]+\\.preview\\.example\\.com";

    [Fact, Trait("Lane", "unit")]
    public void No_host_flag_is_the_local_stack_on_port_3000() =>
        Assert.Equal(new ResolvedHost("http://localhost:3000", HostKind.Local), HostGuard.Resolve(host: null, allowPreviewHost: false, previewHostPattern: null).Value);

    [Theory, Trait("Lane", "unit")]
    [InlineData("http://localhost:4000", "http://localhost:4000")]
    [InlineData("http://localhost:4000/", "http://localhost:4000")]
    [InlineData("http://127.0.0.1:5173", "http://127.0.0.1:5173")]
    [InlineData("http://LOCALHOST:8080", "http://localhost:8080")]
    public void A_loopback_origin_on_another_port_is_local_without_any_allow_flag(string host, string origin) =>
        Assert.Equal(new ResolvedHost(origin, HostKind.Local), HostGuard.Resolve(host, allowPreviewHost: false, previewHostPattern: null).Value);

    [Theory, Trait("Lane", "unit")]
    [InlineData("https://pr-123.preview.example.com", "https://pr-123.preview.example.com")]
    [InlineData("https://pr-7.preview.example.com/", "https://pr-7.preview.example.com")]
    public void A_host_matching_the_preview_pattern_with_allow_preview_host_is_a_preview(string host, string origin) =>
        Assert.Equal(new ResolvedHost(origin, HostKind.Preview), HostGuard.Resolve(host, allowPreviewHost: true, Pattern).Value);

    [Theory, Trait("Lane", "unit")]
    [InlineData("https://pr-123.preview.example.com", false, "needs --allow-preview-host")]
    [InlineData("https://dev.preview.example.com", true, "is not a preview host (UI_EVIDENCE_PREVIEW_HOST_PATTERN)")]
    [InlineData("https://app.preview.example.com", true, "dev and prod hosts are refused")]
    [InlineData("https://pr-12.preview.example.com.evil.com", true, "is not a preview host")]
    [InlineData("https://evil-pr-12.preview.example.com", true, "is not a preview host")]
    [InlineData("http://pr-123.preview.example.com", true, "must be https")]
    [InlineData("https://pr-123.preview.example.com:8443", true, "must not carry a port")]
    [InlineData("https://user:pw@pr-123.preview.example.com", true, "credentials")]
    [InlineData("https://pr-123.preview.example.com/admin", true, "bare origin")]
    [InlineData("https://pr-123.preview.example.com/?x=1", true, "bare origin")]
    [InlineData("https://pr-123.preview.example.com/#top", true, "bare origin")]
    [InlineData("http://localhost", false, "http://localhost:<port>")]
    [InlineData("https://localhost:3000", false, "http://localhost:<port>")]
    [InlineData("http://localhost:3000/app", false, "bare origin")]
    [InlineData("http://user@localhost:3000", false, "credentials")]
    [InlineData("http://192.168.1.10:3000", false, "must be https")]
    [InlineData("not a url", true, "is not a URL")]
    public void Any_other_host_is_refused_with_the_reason(string host, bool allowPreview, string reason)
    {
        var result = HostGuard.Resolve(host, allowPreview, Pattern);

        Assert.Equal(EvidenceErrors.HostRefused.Code, result.Error.Code);
        Assert.Contains(reason, result.Error.Message, StringComparison.Ordinal);
    }

    [Theory, Trait("Lane", "unit")]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void With_no_preview_pattern_configured_every_non_loopback_host_is_refused_naming_the_setting(string? pattern)
    {
        var result = HostGuard.Resolve("https://pr-1.preview.example.com", allowPreviewHost: true, pattern);

        Assert.Equal(EvidenceErrors.HostRefused.Code, result.Error.Code);
        Assert.Contains("none is configured (set UI_EVIDENCE_PREVIEW_HOST_PATTERN)", result.Error.Message, StringComparison.Ordinal);
    }

    [Fact, Trait("Lane", "unit")]
    public void An_invalid_preview_pattern_refuses_the_host_without_echoing_the_pattern()
    {
        var result = HostGuard.Resolve("https://pr-1.preview.example.com", allowPreviewHost: true, "pr-(");

        Assert.Equal(EvidenceErrors.HostRefused.Code, result.Error.Code);
        Assert.Contains("UI_EVIDENCE_PREVIEW_HOST_PATTERN is not a valid regular expression", result.Error.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("pr-(", result.Error.Message, StringComparison.Ordinal);
    }

    [Theory, Trait("Lane", "unit")]
    [InlineData("https://pr-2.preview.example.com", true)]
    [InlineData("https://pr-1.preview.example.com.evil.com", false)]
    [InlineData("https://evil-pr-2.preview.example.com", false)]
    public void The_whole_hostname_must_match_so_an_alternation_cannot_widen_the_pattern(string host, bool accepted) =>
        Assert.Equal(!accepted, HostGuard.Resolve(host, allowPreviewHost: true, "pr-1\\.preview\\.example\\.com|pr-2\\.preview\\.example\\.com").IsError);

    [Theory, Trait("Lane", "unit")]
    [InlineData("http://localhost:3000/next", true, false)]
    [InlineData("https://evil.example/x", true, true)]
    [InlineData("https://evil.example/x", false, false)]
    [InlineData("about:blank", true, false)]
    [InlineData("http://localhost:4000/", true, true)]
    [InlineData("::not a url::", true, true)]
    public void Navigation_off_the_vetted_origin_is_aborted(string url, bool isNavigation, bool aborted) =>
        Assert.Equal(aborted, HostGuard.IsOffOriginNavigation("http://localhost:3000", url, isNavigation));

    [Theory, Trait("Lane", "unit")]
    [InlineData("https://app.example:8443/dashboard?token=x", "https://app.example:8443")]
    [InlineData("http://127.0.0.1:5000/login", "http://127.0.0.1:5000")]
    [InlineData("data:text/html,<form>", "data:")]
    [InlineData("::not a url::", "an unparseable URL")]
    public void A_page_is_named_by_its_origin_never_its_path_or_query(string url, string named) =>
        Assert.Equal(named, HostGuard.OriginOf(url));

    [Theory, Trait("Lane", "unit")]
    [InlineData("http://localhost:3000", true)]
    [InlineData("http://127.0.0.1:4000", true)]
    [InlineData("https://pr-1.preview.example.com", false)]
    [InlineData("nonsense", false)]
    public void Only_this_machine_counts_as_local(string origin, bool local) =>
        Assert.Equal(local, HostGuard.IsLocal(origin));
}
