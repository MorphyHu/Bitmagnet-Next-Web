"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Pagination, Select, SelectItem } from "@nextui-org/react";
import { useTranslations } from "next-intl";
import { useIsSSR } from "@react-aria/ssr";

import SearchResultsItem from "./SearchResultsItem";

import { SearchResultsListProps } from "@/types";
import { $env } from "@/utils";
import { SEARCH_PARAMS, SEARCH_PAGE_MAX } from "@/config/constant";

export default function SearchResultsList({
  resultList,
  keywords,
  cost_time = 0,
  hasMore,
  searchOption,
}: {
  resultList: SearchResultsListProps["torrents"];
  keywords: string[];
  cost_time: number;
  hasMore: boolean;
  searchOption: {
    keyword: string;
    p: number;
    ps: number;
    sortType: string;
    filterTime: string;
    filterSize: string;
  };
}) {
  const router = useRouter();
  const isSSR = useIsSSR();
  const t = useTranslations();
  const [count, setCount] = useState<number>();
  const [countStatus, setCountStatus] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const { keyword, filterTime, filterSize, p, ps } = searchOption;
  const totalCount =
    count ?? (p === 1 && !hasMore ? resultList.length : undefined);

  async function loadCount() {
    setCountStatus("loading");
    try {
      const response = await fetch("/api/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query SearchCount($input: SearchFiltersInput!) {
            searchCount(input: $input)
          }`,
          variables: { input: { keyword, filterTime, filterSize } },
        }),
      });
      const { data } = await response.json();

      if (!response.ok || typeof data?.searchCount !== "number") {
        throw new Error("Search count unavailable");
      }

      setCount(data.searchCount);
      setCountStatus("idle");
    } catch {
      setCountStatus("error");
    }
  }

  const handleFilterChange = (type: string, value: string) => {
    const updatedSearchOption = {
      ...searchOption,
      [type]: value,
    };

    handlePageChange(1, updatedSearchOption);
  };

  const handlePageChange = (
    page: number,
    newSearchOption: typeof searchOption,
  ) => {
    const params = new URLSearchParams();

    params.set("keyword", newSearchOption.keyword);
    params.set("p", String(page));
    params.set("ps", String(newSearchOption.ps));

    if (newSearchOption.sortType) {
      params.set("sortType", newSearchOption.sortType);
    }

    if (newSearchOption.filterTime) {
      params.set("filterTime", newSearchOption.filterTime);
    }

    if (newSearchOption.filterSize) {
      params.set("filterSize", newSearchOption.filterSize);
    }

    const url = `/search?${params.toString()}`;

    router.push(url);
  };

  const knownPages = totalCount === undefined ? 0 : Math.ceil(totalCount / ps);
  const pageCount = Math.min(
    SEARCH_PAGE_MAX,
    Math.max(p + (hasMore ? 1 : 0), knownPages),
  );

  return (
    <>
      <div className="flex gap-2 my-4">
        {Object.entries(SEARCH_PARAMS).map(([key, value]) => (
          <Select
            key={key}
            className="w-full"
            classNames={{
              label: "text-xs md:text-sm",
              trigger: "h-10 min-h-10 md:h-12 md:min-h-12",
              value: "text-xs md:text-sm",
            }}
            defaultSelectedKeys={[
              searchOption[key as keyof typeof searchOption],
            ]}
            label={t(`Search.filterLabel.${key}`)}
            popoverProps={{
              className: "w-full flex justify-center",
              classNames: {
                content: "bg-opacity-70 backdrop-blur-sm min-w-fit px-1",
              },
            }}
            selectedKeys={[searchOption[key as keyof typeof searchOption]]}
            size="sm"
            onChange={(e) => handleFilterChange(key, e.target.value)}
          >
            {value.map((item) => (
              <SelectItem
                key={item}
                className="w-full !bg-opacity-60"
                classNames={{
                  title: "text-xs md:text-sm",
                }}
              >
                {t(`Search.${key}.${item}`)}
              </SelectItem>
            ))}
          </Select>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-2 text-sm text-gray-500">
        <span aria-live="polite">
          {totalCount === undefined
            ? t("Search.results_on_page", { count: resultList.length })
            : t("Search.results_found", { count: totalCount })}
        </span>
        {cost_time > 0 && (
          <span className="text-xs">
            {t("Search.cost_time", { cost_time })}
          </span>
        )}
        {totalCount === undefined && (
          <Button
            isLoading={countStatus === "loading"}
            size="sm"
            variant="light"
            onPress={loadCount}
          >
            {t("Search.show_total_count")}
          </Button>
        )}
        {countStatus === "error" && (
          <span role="status">{t("Search.total_count_error")}</span>
        )}
      </div>

      {resultList.map((item) => (
        <div key={item.hash} className="mb-6">
          <SearchResultsItem item={item} keywords={keywords} />
        </div>
      ))}

      {!isSSR && pageCount > 1 && (
        <Pagination
          key={`pagi_${Object.values(searchOption).join("_")}`}
          className="flex justify-center"
          classNames={{
            wrapper: "gap-x-2",
          }}
          page={p}
          showControls={$env.isDesktop}
          siblings={$env.isMobile ? 1 : 3}
          size={$env.isMobile ? "lg" : "md"}
          total={pageCount}
          onChange={(page) => handlePageChange(page, searchOption)}
        />
      )}
    </>
  );
}
