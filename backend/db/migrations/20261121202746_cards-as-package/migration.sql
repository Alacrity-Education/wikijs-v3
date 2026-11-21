-- Fork: the Cards block (`block-cards`, with `block-card` inside it) has left the build and is
-- distributed as a package instead (`block-cards.wkblock`, from the Alacrity-Education/wiki-blocks
-- repository), imported under Administration -> Content Blocks.
--
-- Left alone, the next boot's `syncSite` would DELETE each site's `cards` row as a built-in that is no
-- longer installed, taking with it whether the site had Cards switched on and its configuration, and
-- every page saved before the package is imported would lose its cards to the sanitiser.
--
-- So each site's built-in `cards` row becomes a custom row awaiting its package: `isCustom`, with no
-- `packageData` and an empty `checksum`. `syncSite` leaves custom rows alone; `/_blocks/` serves
-- nothing for a custom block without a checksum; and importing the package upgrades the row in place,
-- as it does any custom row, so `isEnabled`, `config` and the row's id are kept.
--
-- Its `definition` is the one the package carries, minus the templates, so that the sanitiser keeps
-- `<block-cards columns>` and `<block-card>` on a page saved or re-rendered in the time between this
-- image starting and the package being imported. The import replaces it whole.
--
-- Only built-in rows, so that running it again (or on a site that already imported the package)
-- changes nothing.
UPDATE "blocks"
SET
	"isCustom" = true,
	"packageData" = NULL,
	"checksum" = '',
	"definition" = '{
		"block": "cards",
		"name": "Cards",
		"description": "A row of cards, up to four to a line, each with a title, a picture and text below it.",
		"icon": "module",
		"props": [
			{
				"name": "columns",
				"type": "select",
				"label": "Cards per Line",
				"hint": "The most cards side by side. Fewer fit on a narrow screen, and the rest wrap below.",
				"default": "3",
				"options": [
					{ "label": "1", "value": "1" },
					{ "label": "2", "value": "2" },
					{ "label": "3", "value": "3" },
					{ "label": "4", "value": "4" }
				]
			}
		],
		"children": [
			{
				"block": "card",
				"name": "Card",
				"description": "One card of a row of cards.",
				"icon": "resume-template",
				"props": [],
				"isChild": true
			}
		]
	}'::jsonb
WHERE "block" = 'cards' AND "isCustom" = false;
