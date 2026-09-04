export interface MovieSummary {
  id: string
  title: string
  year: string
  poster: string | null
}

export interface MovieDetails extends MovieSummary {
  plot: string
  genre: string
  director: string
  actors: string
  runtime: string
  rating: string
  country: string
}

export interface MovieSearch {
  movies: MovieSummary[]
  totalResults: number
  page: number
  totalPages: number
}
