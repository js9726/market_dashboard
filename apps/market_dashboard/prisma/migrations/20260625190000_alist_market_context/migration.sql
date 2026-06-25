-- Entry/exit market backdrop on each A-list candidate (P4).
-- "Was it the pick or the tape?" — SPY/QQQ %, advance/decline breadth, Fear&Greed
-- captured at entry day and again at exit. Both nullable JSONB; backfilled going
-- forward by the extractor (entry) and the close/track crons (exit).
ALTER TABLE "AListCandidate" ADD COLUMN "day0Market" JSONB;
ALTER TABLE "AListCandidate" ADD COLUMN "exitMarket" JSONB;
