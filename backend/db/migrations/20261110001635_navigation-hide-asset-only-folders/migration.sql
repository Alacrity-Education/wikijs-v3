-- A display setting of the site's navigation, off: leave out of the sidebar the menu items opening a
-- folder that holds files and no pages, or draw them as a plain link to the page sharing the folder's
-- path where there is one.
--
-- A data migration for the reason the other navigation settings had one: a site's settings are read
-- back from the `config` JSONB column verbatim, so a key added in the code is missing from every site
-- that already exists. Off here as it is for a new site -- turning it on changes what readers are
-- shown, which is the administrator's call.
--
-- Only where the key is absent, so that running it again changes nothing.
UPDATE "sites"
SET "config" = jsonb_set(
		"config",
		'{navigation}',
		'{"hideAssetOnlyFolders":false}'::jsonb || coalesce("config" -> 'navigation', '{}'::jsonb),
		true
	)
WHERE "config" -> 'navigation' -> 'hideAssetOnlyFolders' IS NULL;
