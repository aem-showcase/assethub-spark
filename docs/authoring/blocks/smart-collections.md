# Smart Collections

Displays every Smart Collection available to the signed-in user as a responsive card grid. This includes the user's personal collections and collections shared publicly with the organization.

Each card uses the first asset matching the collection's saved query, facets, and sort order as its thumbnail. Selecting a card opens the search page with the same criteria.

## Authoring

Add a one-cell block with no configuration rows:

| Smart Collections |
|-------------------|

The block loads its content dynamically. Authors do not add cards or collection identifiers to the block.

## States

- A loading message appears while collections are retrieved.
- An empty message appears when no collections are available.
- A placeholder appears when a collection has no matching asset or its thumbnail cannot be loaded.
- An error message appears if the Smart Collections list cannot be retrieved.

## Tips

- Add a heading such as **Featured Smart Collections** immediately before the block.
- Collection titles, descriptions, visibility, and saved criteria are managed on the search page.
- Keep collection titles concise so card grids remain easy to scan.