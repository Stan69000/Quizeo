export type CinemaCategory = 'film' | 'serie' | 'animation';

export interface CinemaItem {
  id: string;
  title: string;
  year: number;
  category: CinemaCategory;
  /** Passed verbatim to yt-dlp ytsearch1: to find the trailer */
  searchQuery: string;
  /** Optional Wikipedia page title if different from film title */
  wikiTitle?: string;
}

export const CINEMA_CATALOG: CinemaItem[] = [
  // ── Films ────────────────────────────────────────────────────────────────
  { id: 'titanic',        title: 'Titanic',                    year: 1997, category: 'film',      searchQuery: 'Titanic 1997 official trailer',                        wikiTitle: 'Titanic (film, 1997)' },
  { id: 'starwars4',      title: 'Star Wars',                  year: 1977, category: 'film',      searchQuery: 'Star Wars A New Hope 1977 original trailer' },
  { id: 'lotr1',          title: 'Le Seigneur des Anneaux',    year: 2001, category: 'film',      searchQuery: 'Lord of the Rings Fellowship of the Ring official trailer 2001' },
  { id: 'avatar',         title: 'Avatar',                     year: 2009, category: 'film',      searchQuery: 'Avatar 2009 official trailer James Cameron' },
  { id: 'inception',      title: 'Inception',                  year: 2010, category: 'film',      searchQuery: 'Inception official trailer 2010' },
  { id: 'endgame',        title: 'Avengers: Endgame',          year: 2019, category: 'film',      searchQuery: 'Avengers Endgame official trailer 2019' },
  { id: 'darkknight',     title: 'The Dark Knight',            year: 2008, category: 'film',      searchQuery: 'The Dark Knight official trailer 2008' },
  { id: 'interstellar',   title: 'Interstellar',               year: 2014, category: 'film',      searchQuery: 'Interstellar official trailer 2014' },
  { id: 'parasite',       title: 'Parasite',                   year: 2019, category: 'film',      searchQuery: 'Parasite Bong Joon-ho official trailer 2019' },
  { id: 'pulpfiction',    title: 'Pulp Fiction',               year: 1994, category: 'film',      searchQuery: 'Pulp Fiction 1994 trailer Tarantino' },
  { id: 'forrestgump',    title: 'Forrest Gump',               year: 1994, category: 'film',      searchQuery: 'Forrest Gump official trailer 1994' },
  { id: 'gladiator',      title: 'Gladiator',                  year: 2000, category: 'film',      searchQuery: 'Gladiator 2000 official trailer Ridley Scott' },
  { id: 'matrix',         title: 'Matrix',                     year: 1999, category: 'film',      searchQuery: 'The Matrix 1999 official trailer' },
  { id: 'jurassicpark',   title: 'Jurassic Park',              year: 1993, category: 'film',      searchQuery: 'Jurassic Park 1993 official trailer Spielberg' },
  { id: 'intouchables',   title: 'Intouchables',               year: 2011, category: 'film',      searchQuery: 'Intouchables 2011 bande annonce officielle' },
  { id: 'amelie',         title: 'Le Fabuleux Destin d\'Amélie Poulain', year: 2001, category: 'film', searchQuery: 'Amélie Poulain bande annonce 2001' },
  { id: 'lalaland',       title: 'La La Land',                 year: 2016, category: 'film',      searchQuery: 'La La Land official trailer 2016' },
  { id: 'bohemianrhapsody', title: 'Bohemian Rhapsody',        year: 2018, category: 'film',      searchQuery: 'Bohemian Rhapsody official trailer 2018' },
  { id: 'topgun2',        title: 'Top Gun: Maverick',          year: 2022, category: 'film',      searchQuery: 'Top Gun Maverick official trailer 2022' },
  { id: 'dune',           title: 'Dune',                       year: 2021, category: 'film',      searchQuery: 'Dune Part One official trailer 2021' },
  { id: 'oppenheimer',    title: 'Oppenheimer',                year: 2023, category: 'film',      searchQuery: 'Oppenheimer official trailer 2023 Nolan' },
  { id: 'barbie',         title: 'Barbie',                     year: 2023, category: 'film',      searchQuery: 'Barbie movie official trailer 2023' },
  { id: 'spidermanNWH',   title: 'Spider-Man: No Way Home',    year: 2021, category: 'film',      searchQuery: 'Spider-Man No Way Home official trailer 2021' },
  { id: 'frozen',         title: 'La Reine des Neiges',        year: 2013, category: 'film',      searchQuery: 'Frozen 2013 official trailer Disney' },
  { id: 'whiplash',       title: 'Whiplash',                   year: 2014, category: 'film',      searchQuery: 'Whiplash official trailer 2014' },
  { id: 'lesgendarmes',   title: 'Le Gendarme de Saint-Tropez', year: 1964, category: 'film',    searchQuery: 'Le Gendarme de Saint-Tropez bande annonce' },
  { id: 'bienvenue',      title: 'Bienvenue chez les Ch\'tis', year: 2008, category: 'film',     searchQuery: 'Bienvenue chez les Chtis bande annonce 2008' },
  { id: 'lesgrandesvacan', title: 'Les Grandes Vacances',      year: 1967, category: 'film',     searchQuery: 'Les Grandes Vacances 1967 bande annonce De Funès' },
  { id: 'leperepoel',     title: 'Le Père Noël est une Ordure', year: 1982, category: 'film',    searchQuery: 'Le Père Noël est une ordure bande annonce 1982' },
  { id: 'taxi',           title: 'Taxi',                       year: 1998, category: 'film',      searchQuery: 'Taxi 1998 bande annonce Besson' },

  // ── Séries ───────────────────────────────────────────────────────────────
  { id: 'got',            title: 'Game of Thrones',            year: 2011, category: 'serie',     searchQuery: 'Game of Thrones season 1 official trailer HBO' },
  { id: 'breakingbad',    title: 'Breaking Bad',               year: 2008, category: 'serie',     searchQuery: 'Breaking Bad official trailer AMC' },
  { id: 'strangerthings', title: 'Stranger Things',            year: 2016, category: 'serie',     searchQuery: 'Stranger Things season 1 official trailer Netflix' },
  { id: 'friends',        title: 'Friends',                    year: 1994, category: 'serie',     searchQuery: 'Friends TV show opening season 1 NBC' },
  { id: 'lacasadepapel',  title: 'La Casa de Papel',           year: 2017, category: 'serie',     searchQuery: 'La Casa de Papel Money Heist official trailer Netflix' },
  { id: 'squidgame',      title: 'Squid Game',                 year: 2021, category: 'serie',     searchQuery: 'Squid Game official trailer Netflix 2021' },
  { id: 'peakyblinders',  title: 'Peaky Blinders',             year: 2013, category: 'serie',     searchQuery: 'Peaky Blinders official trailer BBC' },
  { id: 'themandalorian', title: 'The Mandalorian',            year: 2019, category: 'serie',     searchQuery: 'The Mandalorian official trailer Disney Plus' },
  { id: 'thelastofus',    title: 'The Last of Us',             year: 2023, category: 'serie',     searchQuery: 'The Last of Us HBO official trailer 2023' },
  { id: 'severance',      title: 'Severance',                  year: 2022, category: 'serie',     searchQuery: 'Severance Apple TV official trailer 2022' },
  { id: 'blackmirror',    title: 'Black Mirror',               year: 2011, category: 'serie',     searchQuery: 'Black Mirror official trailer Netflix' },
  { id: 'thecrown',       title: 'The Crown',                  year: 2016, category: 'serie',     searchQuery: 'The Crown Netflix official trailer season 1' },
  { id: 'lupin',          title: 'Lupin',                      year: 2021, category: 'serie',     searchQuery: 'Lupin Netflix bande annonce officielle 2021' },
  { id: 'emilyparis',     title: 'Emily in Paris',             year: 2020, category: 'serie',     searchQuery: 'Emily in Paris Netflix official trailer' },
  { id: 'theoffice',      title: 'The Office',                 year: 2005, category: 'serie',     searchQuery: 'The Office US official trailer NBC' },
  { id: 'succession',     title: 'Succession',                 year: 2018, category: 'serie',     searchQuery: 'Succession HBO official trailer' },
  { id: 'wednesday',      title: 'Mercredi',                   year: 2022, category: 'serie',     searchQuery: 'Wednesday Netflix official trailer 2022' },
  { id: 'arcane',         title: 'Arcane',                     year: 2021, category: 'serie',     searchQuery: 'Arcane League of Legends Netflix official trailer' },

  // ── Animation ────────────────────────────────────────────────────────────
  { id: 'lionking',       title: 'Le Roi Lion',                year: 1994, category: 'animation', searchQuery: 'The Lion King 1994 official trailer Disney' },
  { id: 'toystory',       title: 'Toy Story',                  year: 1995, category: 'animation', searchQuery: 'Toy Story 1995 official trailer Pixar' },
  { id: 'shrek',          title: 'Shrek',                      year: 2001, category: 'animation', searchQuery: 'Shrek 2001 official trailer DreamWorks' },
  { id: 'spiritedaway',   title: 'Le Voyage de Chihiro',       year: 2001, category: 'animation', searchQuery: 'Spirited Away official trailer Miyazaki 2001' },
  { id: 'nemo',           title: 'Le Monde de Nemo',           year: 2003, category: 'animation', searchQuery: 'Finding Nemo 2003 official trailer Pixar' },
  { id: 'incredibles',    title: 'Les Indestructibles',        year: 2004, category: 'animation', searchQuery: 'The Incredibles 2004 official trailer Pixar' },
  { id: 'coco',           title: 'Coco',                       year: 2017, category: 'animation', searchQuery: 'Coco 2017 official trailer Pixar' },
  { id: 'ratatouille',    title: 'Ratatouille',                year: 2007, category: 'animation', searchQuery: 'Ratatouille 2007 official trailer Pixar' },
  { id: 'up',             title: 'Là-Haut',                    year: 2009, category: 'animation', searchQuery: 'Up Pixar 2009 official trailer' },
  { id: 'walle',          title: 'WALL-E',                     year: 2008, category: 'animation', searchQuery: 'WALL-E 2008 official trailer Pixar' },
  { id: 'encanto',        title: 'Encanto',                    year: 2021, category: 'animation', searchQuery: 'Encanto 2021 official trailer Disney' },
  { id: 'moana',          title: 'Vaiana',                     year: 2016, category: 'animation', searchQuery: 'Moana Vaiana 2016 official trailer Disney' },
  { id: 'kungfupanda',    title: 'Kung Fu Panda',              year: 2008, category: 'animation', searchQuery: 'Kung Fu Panda 2008 official trailer DreamWorks' },
  { id: 'minions',        title: 'Les Minions',                year: 2015, category: 'animation', searchQuery: 'Minions 2015 official trailer Illumination' },
  { id: 'mononoke',       title: 'Princesse Mononoké',         year: 1997, category: 'animation', searchQuery: 'Princess Mononoke official trailer 1997 Miyazaki' },
  { id: 'puss',           title: 'Le Chat Potté 2',            year: 2022, category: 'animation', searchQuery: 'Puss in Boots The Last Wish official trailer 2022' },
];

export const CATEGORY_LABELS: Record<CinemaCategory, string> = {
  film:      '🎬 Films',
  serie:     '📺 Séries',
  animation: '🎨 Animation',
};

export function getItemsByCategory(cat: CinemaCategory | 'all'): CinemaItem[] {
  if (cat === 'all') return CINEMA_CATALOG;
  return CINEMA_CATALOG.filter((i) => i.category === cat);
}

export function buildQcmOptions(correct: CinemaItem, pool: CinemaItem[]): string[] {
  const wrongs = pool
    .filter((i) => i.id !== correct.id)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map((i) => i.title);
  return [...wrongs, correct.title].sort(() => Math.random() - 0.5);
}
