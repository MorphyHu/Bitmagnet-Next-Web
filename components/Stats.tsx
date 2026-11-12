import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Spinner } from "@nextui-org/react";

import apiFetch from "@/utils/api";
import { formatByteSize, formatDate } from "@/utils";

async function StatsCard() {
  const t = await getTranslations();

  const { data } = await apiFetch("/api/stats", {
    next: { revalidate: 60 },
  });

  return (
    <div className="text-xs text-foreground-600 bg-background/80 backdrop-blur-sm rounded-lg p-3 shadow-lg border border-default-200">
      <h4 className="font-bold mb-2">{t("Stats.title")}</h4>
      <ul className="space-y-1">
        <li>{t("Stats.size", { size: formatByteSize(data.size) })}</li>
        <li>
          {t("Stats.total_count", {
            total_count: data.total_count.toLocaleString(),
          })}
        </li>
        <li>
          {t("Stats.updated_at", {
            updated_at: formatDate(
              data.updated_at,
              t("COMMON.DATE_FORMAT_SHORT"),
            ),
          })}
        </li>
      </ul>
    </div>
  );
}

export function Stats() {
  return (
    <Suspense fallback={<Spinner size="sm" />}>
      <StatsCard />
    </Suspense>
  );
}
