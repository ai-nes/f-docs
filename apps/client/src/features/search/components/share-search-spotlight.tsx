import { Box, Group, Center, Text } from "@mantine/core";
import { Spotlight } from "@mantine/spotlight";
import { IconSearch } from "@tabler/icons-react";
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDebouncedValue } from "@mantine/hooks";
import { useShareSearchQuery } from "@/features/search/queries/search-query";
import { buildSharedPageUrl } from "@/features/page/page.utils.ts";
import { getPageIcon } from "@/lib";
import { useTranslation } from "react-i18next";
import { shareSearchSpotlightStore } from "@/features/search/constants.ts";
import DOMPurify from "dompurify";
import type { SharedPageTreeNode } from "@/features/share/utils.ts";

interface ShareSearchSpotlightProps {
  shareId?: string;
  pages?: SharedPageTreeNode[] | null;
}

interface FlattenedSharedPage {
  node: SharedPageTreeNode;
  depth: number;
}

function flattenSharedPageTree(
  nodes: SharedPageTreeNode[],
  depth = 0,
): FlattenedSharedPage[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...flattenSharedPageTree(node.children ?? [], depth + 1),
  ]);
}

export function ShareSearchSpotlight({
  shareId,
  pages,
}: ShareSearchSpotlightProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debouncedSearchQuery] = useDebouncedValue(query, 300);

  const { data: searchResults } = useShareSearchQuery({
    query: debouncedSearchQuery,
    shareId,
  });

  const browsePages = useMemo(
    () => flattenSharedPageTree(pages ?? []),
    [pages],
  );

  const browsePageActions = browsePages.map(({ node, depth }) => {
    const pageTitle = node.name || t("untitled");

    return (
      <Spotlight.Action
        key={node.slugId}
        component={Link}
        //@ts-ignore
        to={buildSharedPageUrl({
          shareId: shareId,
          pageTitle,
          pageSlugId: node.slugId,
        })}
        style={{
          userSelect: "none",
          paddingLeft: `${12 + depth * 20}px`,
        }}
      >
        <Group wrap="nowrap" w="100%">
          <Center>{getPageIcon(node.icon)}</Center>
          <Text truncate>{pageTitle}</Text>
        </Group>
      </Spotlight.Action>
    );
  });

  const searchResultActions = (
    searchResults && searchResults.length > 0 ? searchResults : []
  ).map((page) => (
    <Spotlight.Action
      key={page.id}
      component={Link}
      //@ts-ignore
      to={buildSharedPageUrl({
        shareId: shareId,
        pageTitle: page.title,
        pageSlugId: page.slugId,
      })}
      style={{ userSelect: "none" }}
    >
      <Group wrap="nowrap" w="100%">
        <Center>{getPageIcon(page?.icon)}</Center>

        <div style={{ flex: 1 }}>
          <Text>{page.title}</Text>

          {page?.highlight && (
            <Text
              opacity={0.6}
              size="xs"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(page.highlight, {
                  ALLOWED_TAGS: ["mark", "em", "strong", "b"],
                  ALLOWED_ATTR: []
                }),
              }}
            />
          )}
        </div>
      </Group>
    </Spotlight.Action>
  ));

  return (
    <>
      <Spotlight.Root
        store={shareSearchSpotlightStore}
        query={query}
        onQueryChange={setQuery}
        onSpotlightOpen={() => setQuery("")}
        scrollable
        overlayProps={{
          backgroundOpacity: 0.55,
        }}
      >
        <Spotlight.Search
          placeholder={t("Search...")}
          aria-label={t("Search")}
          leftSection={<IconSearch size={20} stroke={1.5} />}
        />
        {query.length === 0 && browsePageActions.length > 0 && (
          <Box px="md" pt="sm" pb={4}>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">
              {t("Pages")}
            </Text>
          </Box>
        )}
        <Spotlight.ActionsList>
          {query.length === 0 && browsePageActions.length > 0 && (
            <>{browsePageActions}</>
          )}

          {query.length === 0 && browsePageActions.length === 0 && (
            <Spotlight.Empty>{t("Start typing to search...")}</Spotlight.Empty>
          )}

          {query.length > 0 && searchResultActions.length === 0 && (
            <Spotlight.Empty>{t("No results found...")}</Spotlight.Empty>
          )}

          {searchResultActions.length > 0 && searchResultActions}
        </Spotlight.ActionsList>
      </Spotlight.Root>
    </>
  );
}
