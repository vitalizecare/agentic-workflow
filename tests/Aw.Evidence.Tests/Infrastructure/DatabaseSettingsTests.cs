using Aw.Evidence.Infrastructure.Stack;

namespace Aw.Evidence.Tests.Infrastructure;

public sealed class DatabaseSettingsTests
{
    [Fact, Trait("Lane", "unit")]
    public void An_unconfigured_install_has_no_container_no_seed_table_and_the_postgres_user() =>
        Assert.Equal(new DatabaseSettings(Container: null, User: "postgres", SeedTable: null), DatabaseSettings.Read(static _ => null));

    [Fact, Trait("Lane", "unit")]
    public void Each_setting_comes_from_its_variable_trimmed() =>
        Assert.Equal(
            new DatabaseSettings(Container: "db_1", User: "app", SeedTable: "public.users"),
            DatabaseSettings.Read(static name => name switch
            {
                "UI_EVIDENCE_DB_CONTAINER" => " db_1 ",
                "UI_EVIDENCE_DB_USER" => "app",
                "UI_EVIDENCE_SEED_TABLE" => "public.users",
                _ => null,
            }));

    [Theory, Trait("Lane", "unit")]
    [InlineData("users")]
    [InlineData("public.users")]
    [InlineData("_t1.Users_2")]
    public void A_plain_table_name_is_kept(string table) =>
        Assert.Equal(table, DatabaseSettings.Read(name => name == "UI_EVIDENCE_SEED_TABLE" ? table : null).SeedTable);

    [Theory, Trait("Lane", "unit")]
    [InlineData("users; DROP TABLE x")]
    [InlineData("public.users.extra")]
    [InlineData("a-b")]
    [InlineData("'users'")]
    [InlineData("  ")]
    public void Anything_but_a_plain_table_name_is_unset_because_it_is_spliced_into_the_sql(string table) =>
        Assert.Null(DatabaseSettings.Read(name => name == "UI_EVIDENCE_SEED_TABLE" ? table : null).SeedTable);
}
