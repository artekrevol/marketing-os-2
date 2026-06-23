-- SQL script to clear and prepare for keywords import
-- First, clear all tables with foreign key relationships to keywords
DELETE FROM "competitors";
DELETE FROM "keywordBatchItems";
DELETE FROM "rankings";
-- Then clear the keywords table
DELETE FROM "keywords";