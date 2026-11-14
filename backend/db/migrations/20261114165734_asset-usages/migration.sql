CREATE TABLE "assetUsages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kind" varchar(16) NOT NULL,
	"raw" text NOT NULL,
	"targetPath" text NOT NULL,
	"startOffset" integer NOT NULL,
	"endOffset" integer NOT NULL,
	"startLine" integer NOT NULL,
	"startColumn" integer NOT NULL,
	"endLine" integer NOT NULL,
	"endColumn" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"assetId" uuid,
	"pageId" uuid NOT NULL,
	"siteId" uuid NOT NULL
);
--> statement-breakpoint
CREATE INDEX "assetUsages_assetId_idx" ON "assetUsages" ("assetId");--> statement-breakpoint
CREATE INDEX "assetUsages_pageId_idx" ON "assetUsages" ("pageId");--> statement-breakpoint
CREATE INDEX "assetUsages_siteId_targetPath_idx" ON "assetUsages" ("siteId","targetPath");--> statement-breakpoint
ALTER TABLE "assetUsages" ADD CONSTRAINT "assetUsages_assetId_assets_id_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "assetUsages" ADD CONSTRAINT "assetUsages_pageId_pages_id_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "assetUsages" ADD CONSTRAINT "assetUsages_siteId_sites_id_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE;