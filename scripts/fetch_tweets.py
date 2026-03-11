"""
Fetch recent tweets from @steve_yeow via X API v2,
filter for insightful thoughts using rule-based heuristics,
and merge into tweets.json.

Required env vars:
  TWITTER_BEARER_TOKEN — X API v2 bearer token

Usage:
  python scripts/fetch_tweets.py
"""

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

TWITTER_USER = "steve_yeow"
TWEETS_FILE = Path(__file__).parent.parent / "tweets.json"
LOOKBACK_DAYS = 7
MAX_TWEETS = 100

MIN_LENGTH = 60
MIN_WORDS = 10

PROMO_PATTERNS = [
    r"\bsign up\b",
    r"\bjoin us\b",
    r"\bwe.re hiring\b",
    r"\bapply now\b",
    r"\blaunch(ed|ing)?\b.*\b(today|now|live)\b",
    r"\bcheck (it )?out\b",
    r"\bgiveaway\b",
    r"\bdiscount\b",
    r"\bpromo code\b",
    r"\buse code\b",
    r"\bfree trial\b",
    r"\bearly access\b",
    r"\bwaitlist\b",
    r"\bpre-?order\b",
    r"\bDM (me|us) (for|to)\b",
    r"\blink in bio\b",
]

SMALLTALK_PATTERNS = [
    r"^(gm|gn|good morning|good night|happy \w+day)\b",
    r"^(thanks|thank you|thx|congrats|congratulations)\b",
    r"^(lol|lmao|haha|wow)\b",
    r"^@\w+\s+(thanks|congrats|love this)",
]


def get_user_id(bearer: str) -> str:
    r = requests.get(
        f"https://api.twitter.com/2/users/by/username/{TWITTER_USER}",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    r.raise_for_status()
    return r.json()["data"]["id"]


def fetch_recent_tweets(bearer: str, user_id: str) -> list[dict]:
    since = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    params = {
        "max_results": MAX_TWEETS,
        "start_time": since,
        "tweet.fields": "created_at,text,public_metrics,referenced_tweets",
    }
    r = requests.get(
        f"https://api.twitter.com/2/users/{user_id}/tweets",
        headers={"Authorization": f"Bearer {bearer}"},
        params=params,
    )
    r.raise_for_status()
    data = r.json()
    return data.get("data", [])


def is_pure_retweet(tweet: dict) -> bool:
    refs = tweet.get("referenced_tweets", [])
    if not refs:
        return False
    return len(refs) == 1 and refs[0]["type"] == "retweeted"


def get_own_text(tweet: dict) -> str:
    """Extract the author's own words, stripping quoted tweet URLs."""
    text = tweet["text"]
    text = re.sub(r"https://t\.co/\w+$", "", text).strip()
    return text


def has_substance(text: str) -> bool:
    words = text.split()
    return len(text) >= MIN_LENGTH and len(words) >= MIN_WORDS


def is_promo(text: str) -> bool:
    lower = text.lower()
    return any(re.search(p, lower) for p in PROMO_PATTERNS)


def is_smalltalk(text: str) -> bool:
    lower = text.lower().strip()
    return any(re.search(p, lower) for p in SMALLTALK_PATTERNS)


def is_just_link(text: str) -> bool:
    stripped = re.sub(r"https?://\S+", "", text).strip()
    words = stripped.split()
    return len(words) < 5


def is_just_mention_reply(text: str) -> bool:
    """Short replies that are just @mentions with a few words."""
    stripped = re.sub(r"@\w+", "", text).strip()
    return len(stripped.split()) < 6


def score_tweet(tweet: dict) -> float:
    """
    Score a tweet for "insightfulness". Higher = more likely to be a thought.
    Returns 0 if the tweet should be excluded.
    """
    if is_pure_retweet(tweet):
        return 0

    text = get_own_text(tweet)

    if is_smalltalk(text):
        return 0
    if is_promo(text):
        return 0
    if is_just_link(text):
        return 0
    if is_just_mention_reply(text):
        return 0

    score = 0.0

    if has_substance(text):
        score += 3.0

    word_count = len(text.split())
    if word_count >= 20:
        score += 1.0
    if word_count >= 40:
        score += 1.0

    metrics = tweet.get("public_metrics", {})
    likes = metrics.get("like_count", 0)
    retweets = metrics.get("retweet_count", 0)
    replies = metrics.get("reply_count", 0)
    impressions = metrics.get("impression_count", 0)

    engagement = likes + retweets * 2 + replies
    if engagement >= 5:
        score += 1.0
    if engagement >= 20:
        score += 1.0
    if engagement >= 100:
        score += 2.0
    if impressions >= 10000:
        score += 1.0
    if impressions >= 100000:
        score += 2.0

    refs = tweet.get("referenced_tweets", [])
    is_quote = any(r["type"] == "quoted" for r in refs)
    is_reply = any(r["type"] == "replied_to" for r in refs)

    if is_quote and has_substance(text):
        score += 1.0

    if is_reply and has_substance(text):
        score += 0.5

    if is_reply and not has_substance(text):
        score -= 2.0

    return max(score, 0)


def filter_tweets(tweets: list[dict]) -> list[dict]:
    scored = []
    for t in tweets:
        s = score_tweet(t)
        if s >= 3.0:
            scored.append((s, t))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [t for _, t in scored]


def load_existing() -> list[dict]:
    if TWEETS_FILE.exists():
        return json.loads(TWEETS_FILE.read_text())
    return []


def save_tweets(tweets: list[dict]):
    tweets.sort(key=lambda t: t["date"], reverse=True)
    TWEETS_FILE.write_text(json.dumps(tweets, indent=2, ensure_ascii=False) + "\n")


def main():
    bearer = os.environ.get("TWITTER_BEARER_TOKEN")

    if not bearer:
        print("TWITTER_BEARER_TOKEN not set, skipping.")
        sys.exit(0)

    print(f"Fetching tweets from @{TWITTER_USER}...")
    user_id = get_user_id(bearer)
    raw_tweets = fetch_recent_tweets(bearer, user_id)
    print(f"  Found {len(raw_tweets)} tweets in last {LOOKBACK_DAYS} days.")

    if not raw_tweets:
        print("  No new tweets to process.")
        return

    print("  Filtering with heuristics...")
    insightful = filter_tweets(raw_tweets)
    print(f"  {len(insightful)} tweets passed filter (score >= 3.0).")

    existing = load_existing()
    existing_urls = {t.get("url", "") for t in existing}
    existing_texts = {t.get("text", "")[:80] for t in existing}

    added = 0
    for t in insightful:
        tweet_url = f"https://x.com/{TWITTER_USER}/status/{t['id']}"
        own_text = get_own_text(t)
        text_prefix = own_text[:80]

        if tweet_url in existing_urls or text_prefix in existing_texts:
            continue

        existing.append(
            {
                "id": t["id"],
                "date": t["created_at"][:10],
                "text": own_text,
                "url": tweet_url,
            }
        )
        added += 1

    if added:
        save_tweets(existing)
        print(f"  Added {added} new tweets to tweets.json")
    else:
        print("  No new unique tweets to add.")


if __name__ == "__main__":
    main()
