import type { WordDiff } from '../types'

function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, '')
    .split(/\s+/)
    .filter(Boolean)
}

export function wordAccuracy(expected: string, spoken: string): number {
  const exp = normalise(expected)
  const got = normalise(spoken)
  if (exp.length === 0) return 100

  // Levenshtein distance at word level
  const m = exp.length
  const n = got.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (exp[i - 1] === got[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
  }

  const distance = dp[m][n]
  return Math.max(0, Math.round(((m - distance) / m) * 100))
}

export function buildWordDiff(expected: string, spoken: string): WordDiff[] {
  const expWords = normalise(expected)
  const gotWords = normalise(spoken)
  const m = expWords.length
  const n = gotWords.length

  // LCS-based alignment
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  )

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      lcs[i][j] =
        expWords[i - 1] === gotWords[j - 1]
          ? lcs[i - 1][j - 1] + 1
          : Math.max(lcs[i - 1][j], lcs[i][j - 1])
    }
  }

  const result: WordDiff[] = []
  let i = m, j = n
  const path: { match: boolean; word: string }[] = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && expWords[i - 1] === gotWords[j - 1]) {
      path.push({ match: true, word: expWords[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      j--
    } else {
      path.push({ match: false, word: expWords[i - 1] })
      i--
    }
  }

  path.reverse().forEach(p => result.push(p))
  return result
}
