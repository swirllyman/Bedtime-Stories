# Bedtime Stories

A plain, dim-screen-friendly page of bedtime stories for ages 1 to 6, hosted on GitHub Pages.

Every morning a GitHub Action picks three stories for tonight (one each for ages 1–2, 3–4 and 5–6) from a library of public-domain classics, rotating so every story comes up before any repeats.

## Where the stories come from

All stories are public domain, taken word for word from Project Gutenberg editions:

- *The Real Mother Goose* (1916): nursery rhymes, grouped five to a night
- *The Aesop for Children* (1919): short fables with their morals
- Beatrix Potter: *Peter Rabbit*, *Mrs. Tiggy-Winkle*, *Mrs. Tittlemouse*, *Two Bad Mice*
- Thornton W. Burgess, *Old Mother West Wind* (1910)

Illustrations are the originals from the same public-domain books (Blanche Fisher Wright, Milo Winter, Beatrix Potter, and Harrison Cady for the Burgess stories). They are dimmed in dark mode, and the **Pictures off** switch at the bottom of every page hides them (the phone remembers the choice).

Old books can carry things you would not read to a small child today, so each piece was screened by hand. Rhymes and stories with violence, hunting, punishment by beating, death, or ethnic and racial caricature were left out.

## Features

- **Tonight**: three stories in a row, each with one of the book's original illustrations and a one-line description. **Shuffle** swaps in three other stories for the night.
- **Suggestions** on the home page based on what you have rated.
- **Library**: every story, grouped by author, kind of story, age, rating or title. Tap an author or kind of story to see all of them.
- **Ratings**: one to five stars at the end of every story. Ratings and favorites feed the suggestions.
- **Likes**: bar charts of average stars by author, kind of story and theme, and what to try next.
- **Favorites**, with a backup code you can copy to another phone.
- Dark and light modes, adjustable text size, and the screen stays awake while a story is open.

Favorites and ratings live in your phone's browser storage, not on the server.

## Running it

1. In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
2. Run the **Daily stories and site deploy** workflow once from the Actions tab.

The site is then at `https://swirllyman.github.io/Bedtime-Stories/`. To test locally, run `python3 -m http.server` in the repo and open `http://localhost:8000`.

To pick a night by hand: `node scripts/rotate.mjs 2026-11-05`.

## Adding stories

Add entries to `stories/library.json`. Each story has an `id`, `title`, `age` (`1–2`, `3–4` or `5–6`), `author`, `genre`, `tags`, `summary`, `minutes`, `source`, optional `moral`, and `paragraphs`.
