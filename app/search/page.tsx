import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@nextui-org/react";

import { SearchInput } from "@/components/SearchInput";
import SearchResultsList from "@/components/SearchResultsList";
import apiFetch from "@/utils/api";
import { MagnetIcon } from "@/components/icons";
import { siteConfig } from "@/config/site";
import { SearchResultsListProps } from "@/types";
import {
  DEFAULT_SORT_TYPE,
  SEARCH_PAGE_SIZE,
  DEFAULT_FILTER_TIME,
  DEFAULT_FILTER_SIZE,
  SEARCH_PAGE_MAX,
} from "@/config/constant";

type SearchParams = {
  keyword: string;
  p?: string;
  ps?: string;
  sortType?: string;
  filterTime?: string;
  filterSize?: string;
};

// Generate metadata for the search page
export async function generateMetadata({
  searchParams: { keyword },
}: {
  searchParams: { keyword: string };
}): Promise<Metadata> {
  const t = await getTranslations();

  return {
    title: t("Metadata.search.title", { keyword }),
  };
}

// Get search options from the search parameters
function getSearchOption(searchParams: SearchParams) {
  const page = Number.parseInt(searchParams.p ?? "", 10) || 1;
  const pageSize =
    Number.parseInt(searchParams.ps ?? "", 10) || SEARCH_PAGE_SIZE;

  return {
    keyword: searchParams.keyword,
    p: Math.min(Math.max(1, page), SEARCH_PAGE_MAX),
    ps: Math.min(Math.max(1, pageSize), SEARCH_PAGE_SIZE),
    sortType: searchParams.sortType || DEFAULT_SORT_TYPE,
    filterTime: searchParams.filterTime || DEFAULT_FILTER_TIME,
    filterSize: searchParams.filterSize || DEFAULT_FILTER_SIZE,
  };
}

// Component to render the search page
export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const searchOption = getSearchOption(searchParams);
  const { keyword, p, ps, sortType, filterTime, filterSize } = searchOption;
  const params = new URLSearchParams({
    keyword,
    limit: String(ps),
    offset: String((p - 1) * ps),
    sortType,
    filterTime,
    filterSize,
    withTotalCount: "0",
  });

  const start_time = Date.now();
  const { data }: { data: SearchResultsListProps & { keywords: string[] } } =
    await apiFetch(`/api/search?${params}`, {
      next: { revalidate: 60 * 60 * 6 },
    });
  const cost_time = Date.now() - start_time;

  return (
    <div className="w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl 2xl:max-w-6xl">
      <div className="flex items-center mb-7">
        <Link
          className="mb-[-2px] mr-2 md:mr-4 leading-none text-[50px] md:text-[60px]"
          href="/"
          title={siteConfig.name}
        >
          <MagnetIcon />
        </Link>
        <SearchInput defaultValue={searchOption.keyword} />
      </div>
      <SearchResultsList
        key={JSON.stringify([keyword, filterTime, filterSize])}
        cost_time={cost_time}
        hasMore={data.has_more}
        keywords={data.keywords}
        resultList={data.torrents}
        searchOption={searchOption}
      />
    </div>
  );
}
