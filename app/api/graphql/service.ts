import { query } from "@/lib/pgdb";
import { SEARCH_KEYWORD_SPLIT_REGEX } from "@/config/constant";

type Torrent = {
  info_hash: Buffer; // The hash info of the torrent
  name: string; // The name of the torrent
  size: string; // The size of the torrent
  files_count: number; // The count of files in the torrent
  files: TorrentFile[]; // The list of files in the torrent
  created_at: number; // The timestamp when the torrent was created
  updated_at: number; // The timestamp when the torrent was last updated
};

type TorrentFile = {
  index: number; // The index of the file in the torrent
  path: string; // The path of the file in the torrent
  size: string; // The size of the file in the torrent
  extension: string; // The extension of the file
};

const REGEX_HASH = /^[a-f0-9]{40}$/;
const REGEX_PADDING_FILE = /^(_____padding_file_|\.pad\/\d+&)/; // Regular expression to identify padding files

export function formatTorrent(row: Torrent) {
  const hash = row.info_hash.toString("hex"); // Convert info_hash from Buffer to hex string

  const generateSingleFiles = (row: Torrent) => {
    return [
      {
        index: 0,
        path: row.name,
        size: row.size,
        extension: row.name.split(".").pop() || "",
      },
    ];
  };

  return {
    hash: hash,
    name: row.name,
    size: row.size,
    magnet_uri: `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(row.name)}&xl=${row.size}`, // Create magnet URI
    single_file: row.files_count <= 1,
    files_count: row.files_count || 1,
    files: (row.files_count > 0 ? row.files : generateSingleFiles(row))
      .map((file) => ({
        index: file.index,
        path: file.path,
        size: file.size,
        extension: file.extension,
      }))
      .sort((a, b) => {
        // Sorting priority: padding_file lowest -> extension empty next -> ascending index
        const aPadding = REGEX_PADDING_FILE.test(a.path) ? 1 : 0;
        const bPadding = REGEX_PADDING_FILE.test(b.path) ? 1 : 0;

        if (aPadding !== bPadding) {
          return aPadding - bPadding; // padding_file has the lowest priority
        }

        const aNoExtension = !a.extension ? 1 : 0;
        const bNoExtension = !b.extension ? 1 : 0;

        if (aNoExtension !== bNoExtension) {
          return aNoExtension - bNoExtension; // Files with no extension have lower priority
        }

        return a.index - b.index; // Within the same priority, sort by index in ascending order
      }),
    created_at: Math.floor(row.created_at / 1000), // Convert timestamps to seconds
    updated_at: Math.floor(row.updated_at / 1000), // Convert timestamps to seconds
  };
}

type SearchFilters = {
  keyword: string;
  filterTime?: string;
  filterSize?: string;
};

type SearchQueryInput = SearchFilters & {
  limit: number;
  offset: number;
  sortType?: string;
  withTotalCount?: boolean;
};

const orderByMap = new Map([
  ["size", "size DESC"],
  ["count", "COALESCE(files_count, 0) DESC"],
  ["date", "created_at ASC"],
]);

const timeFilterMap = new Map([
  ["gt-1day", "created_at > now() - interval '1 day'"],
  ["gt-7day", "created_at > now() - interval '1 week'"],
  ["gt-31day", "created_at > now() - interval '1 month'"],
  ["gt-365day", "created_at > now() - interval '1 year'"],
]);

const sizeFilterMap = new Map([
  ["lt100mb", "size < 100 * 1024 * 1024::bigint"],
  [
    "gt100mb-lt500mb",
    "size BETWEEN 100 * 1024 * 1024::bigint AND 500 * 1024 * 1024::bigint",
  ],
  [
    "gt500mb-lt1gb",
    "size BETWEEN 500 * 1024 * 1024::bigint AND 1024 * 1024 * 1024::bigint",
  ],
  [
    "gt1gb-lt5gb",
    "size BETWEEN 1024 * 1024 * 1024::bigint AND 5 * 1024 * 1024 * 1024::bigint",
  ],
  ["gt5gb", "size > 5 * 1024 * 1024 * 1024::bigint"],
]);

function buildNameFilter({ keyword, filterTime, filterSize }: SearchFilters) {
  const keywords = Array.from(
    new Set(
      keyword
        .split(SEARCH_KEYWORD_SPLIT_REGEX)
        .filter((word) => word.length >= 2),
    ),
  );
  const conditions = [
    ...keywords.map((_, index) => `name ILIKE $${index + 1}`),
    timeFilterMap.get(filterTime ?? ""),
    sizeFilterMap.get(filterSize ?? ""),
  ];

  return {
    keywords,
    where: conditions.filter(Boolean).join(" AND "),
    params: keywords.map((word) => `%${word}%`),
  };
}

async function countMatches(where: string, params: string[]) {
  const { rows } = await query(
    `SELECT COUNT(*) AS total FROM torrents WHERE ${where}`,
    params,
  );

  return Number(rows[0].total);
}

export async function searchCount(
  _: unknown,
  { input }: { input: SearchFilters },
) {
  const keyword = input.keyword.trim();

  if (REGEX_HASH.test(keyword)) {
    return countMatches("info_hash = decode($1, 'hex')", [keyword]);
  }

  const { keywords, where, params } = buildNameFilter({ ...input, keyword });

  return keywords.length > 0 ? countMatches(where, params) : 0;
}

export async function search(
  _: unknown,
  { queryInput }: { queryInput: SearchQueryInput },
) {
  try {
    const { limit, offset, sortType, withTotalCount } = queryInput;
    const keyword = queryInput.keyword.trim();
    const emptyResult = {
      keywords: [keyword],
      torrents: [],
      total_count: 0,
      has_more: false,
    };

    if (REGEX_HASH.test(keyword)) {
      const torrent = await torrentByHash(_, { hash: keyword });

      return torrent
        ? { ...emptyResult, torrents: [torrent], total_count: 1 }
        : emptyResult;
    }

    const { keywords, where, params } = buildNameFilter({
      ...queryInput,
      keyword,
    });

    if (keywords.length === 0) return emptyResult;

    const orderBy = `${orderByMap.get(sortType ?? "") ?? "created_at DESC"}, info_hash DESC`;
    const pageSize = `$${params.length + 1}`;
    const pageOffset = `$${params.length + 2}`;
    // Keep the extra match out of the file lookups. The candidate set contains at most limit + 1 rows.
    const sql = `
WITH candidates AS (
  SELECT info_hash, name, size, created_at, updated_at, files_count
  FROM torrents
  WHERE ${where}
  ORDER BY ${orderBy}
  LIMIT (${pageSize}::bigint + 1) OFFSET ${pageOffset}
), page AS (
  SELECT * FROM candidates ORDER BY ${orderBy} LIMIT ${pageSize}
)
SELECT page.*,
  EXISTS (SELECT 1 FROM candidates OFFSET ${pageSize}) AS has_more,
  CASE WHEN page.files_count IS NOT NULL THEN (
    SELECT json_agg(json_build_object(
      'index', f.index, 'path', f.path, 'size', f.size, 'extension', f.extension
    ))
    FROM torrent_files f
    WHERE f.info_hash = page.info_hash
  ) END AS files
FROM page
ORDER BY ${orderBy}`;

    const [{ rows }, totalCount] = await Promise.all([
      query(sql, [...params, limit, offset]),
      withTotalCount ? countMatches(where, params) : 0,
    ]);

    return {
      keywords,
      torrents: rows.map(formatTorrent),
      total_count: totalCount,
      has_more: rows[0]?.has_more ?? totalCount > offset,
    };
  } catch (error) {
    console.error("Error in search resolver:", error);
    throw new Error("Failed to execute search query");
  }
}

export async function torrentByHash(_: any, { hash }: { hash: string }) {
  try {
    // SQL query to fetch torrent data and files information by hash
    const sql = `
SELECT
  t.info_hash,
  t.name,
  t.size,
  t.created_at,
  t.updated_at,
  t.files_count,
  json_agg(json_build_object(
    'index', f.index,
    'path', f.path,
    'size', f.size,
    'extension', f.extension
  )) AS files
FROM torrents t
LEFT JOIN torrent_files f ON t.info_hash = f.info_hash
WHERE t.info_hash = decode($1, 'hex')
GROUP BY t.info_hash, t.name, t.size, t.created_at, t.updated_at, t.files_count;
    `;

    const params = [hash];

    const { rows } = await query(sql, params);
    const torrent = rows[0];

    if (!torrent) {
      return null;
    }

    return formatTorrent(torrent);
  } catch (error) {
    console.error("Error in torrentByHash resolver:", error);
    throw new Error("Failed to fetch torrent by hash");
  }
}

export async function statsInfo() {
  try {
    const sql = `
WITH db_size AS (
  SELECT pg_database_size('bitmagnet') AS size
),
torrent_count AS (
  SELECT COUNT(*) AS total_count FROM torrents
),
latest_torrent AS (
  SELECT *
    FROM torrents
    ORDER BY created_at DESC
    LIMIT 1
)
SELECT 
  db_size.size,
  latest_torrent.created_at as updated_at,
  torrent_count.total_count,
  encode(latest_torrent.info_hash, 'hex') AS latest_torrent_hash,
  json_build_object(
    'hash', encode(latest_torrent.info_hash, 'hex'),
    'name', latest_torrent.name,
    'size', latest_torrent.size,
    'created_at', latest_torrent.created_at,
    'updated_at', latest_torrent.updated_at
  ) AS latest_torrent
FROM 
  db_size,
  torrent_count,
  latest_torrent;
    `;

    const { rows } = await query(sql, []);
    const data = rows[0];

    if (!data) {
      return null;
    }

    return {
      ...data,
      updated_at: Math.floor(new Date(data.updated_at).getTime() / 1000),
      latest_torrent: {
        ...data.latest_torrent,
        created_at: Math.floor(
          new Date(data.latest_torrent.created_at).getTime() / 1000,
        ),
        updated_at: Math.floor(
          new Date(data.latest_torrent.updated_at).getTime() / 1000,
        ),
      },
    };
  } catch (error) {
    console.error("Error in statsInfo resolver:", error);
    throw new Error("Failed to fetch torrents count");
  }
}
