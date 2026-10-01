-- ==============================================================================
-- INITIAL PRODUCTION MIGRATION: AP EDITORIAL DATABASE (POSTGRESQL + PGVECTOR)
-- ==============================================================================

-- 1. Enable Required PostgreSQL Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create Enumerations
DO $$ BEGIN
    CREATE TYPE "Role" AS ENUM ('ADMIN', 'CHIEF_EDITOR', 'EDITOR', 'REVIEWER', 'VIEWER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'UPLOADING', 'EXTRACTING_MEDIA', 'TRANSCRIBING', 'GENERATING_KEYFRAMES', 'INDEXING_EMBEDDINGS', 'LOCKED_AND_INDEXED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "DiscoveryRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "CandidateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EDITED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "EditorialAction" AS ENUM ('ACCEPT', 'REJECT', 'AMEND');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Authentication & Users Tables
CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'EDITOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "auth_sessions" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "editor_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preferredLanguages" TEXT[] DEFAULT ARRAY['HINDI', 'ENGLISH']::TEXT[],
    "focusTopics" TEXT[] DEFAULT ARRAY['Bhagavad Gita', 'Vedanta', 'Modern Psychology']::TEXT[],
    "approvalAuthorityLevel" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "editor_profiles_pkey" PRIMARY KEY ("id")
);

-- 4. Video Discourse Sessions Table
CREATE TABLE IF NOT EXISTS "sessions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "seriesCategory" TEXT NOT NULL DEFAULT 'Bhagavad Gita',
    "durationSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "extractionStatus" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "extractionProgress" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "languageDetected" TEXT DEFAULT 'HINDI',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "masterVideoS3Key" TEXT,
    "proxyVideoS3Key" TEXT,
    "audioTrackS3Key" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- 5. Media Assets Table
CREATE TABLE IF NOT EXISTS "media_assets" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "s3Bucket" TEXT NOT NULL DEFAULT 'ap-sessions',
    "fileSizeBytes" BIGINT NOT NULL DEFAULT 0,
    "mimeType" TEXT NOT NULL DEFAULT 'video/mp4',
    "checksumSha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- 6. Scene Cuts Table
CREATE TABLE IF NOT EXISTS "scene_cuts" (
    "id" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sceneIndex" INTEGER NOT NULL DEFAULT 0,
    "startTime" DOUBLE PRECISION NOT NULL,
    "endTime" DOUBLE PRECISION NOT NULL,
    "durationSeconds" DOUBLE PRECISION NOT NULL,
    "shotType" TEXT DEFAULT 'MEDIUM',

    CONSTRAINT "scene_cuts_pkey" PRIMARY KEY ("id")
);

-- 7. Visual Keyframes Table
CREATE TABLE IF NOT EXISTS "keyframes" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "timestamp" DOUBLE PRECISION NOT NULL,
    "imageS3Key" TEXT NOT NULL,
    "sceneId" INTEGER,
    "ocrDetectedText" TEXT,
    "visualDescription" TEXT,
    "speakerInFrame" TEXT,
    "cameraAngle" TEXT DEFAULT 'CLOSE_UP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyframes_pkey" PRIMARY KEY ("id")
);

-- 8. Transcript Segments (Word Timestamps & Diarization)
CREATE TABLE IF NOT EXISTS "transcript_segments" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "segmentIndex" INTEGER NOT NULL DEFAULT 0,
    "startTime" DOUBLE PRECISION NOT NULL,
    "endTime" DOUBLE PRECISION NOT NULL,
    "speakerName" TEXT NOT NULL DEFAULT 'Acharya Prashant',
    "speakerId" INTEGER NOT NULL DEFAULT 0,
    "textHindi" TEXT NOT NULL,
    "textEnglish" TEXT,
    "sentiment" TEXT DEFAULT 'CONTEMPLATIVE',
    "energyLevel" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "wordsJson" JSONB DEFAULT '[]',

    CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("id")
);

-- 9. Semantic Memory Chunks with 1024-dim Vector Embeddings
CREATE TABLE IF NOT EXISTS "semantic_chunks" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "startTime" DOUBLE PRECISION NOT NULL,
    "endTime" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL,
    "dominantTheme" TEXT,
    "embedding" vector(1024),

    CONSTRAINT "semantic_chunks_pkey" PRIMARY KEY ("id")
);

-- 10. AI Discovery Runs
CREATE TABLE IF NOT EXISTS "discovery_runs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'COMPREHENSIVE',
    "focusOptions" JSONB NOT NULL DEFAULT '["qa", "gita"]',
    "customPrompt" TEXT,
    "status" "DiscoveryRunStatus" NOT NULL DEFAULT 'PENDING',
    "progressPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "candidatesFound" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "logs" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "discovery_runs_pkey" PRIMARY KEY ("id")
);

-- 11. Candidate Clips Table
CREATE TABLE IF NOT EXISTS "candidate_clips" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "discoveryRunId" TEXT,
    "rank" INTEGER NOT NULL DEFAULT 1,
    "startTime" DOUBLE PRECISION NOT NULL,
    "endTime" DOUBLE PRECISION NOT NULL,
    "durationSeconds" DOUBLE PRECISION NOT NULL,
    "headline" TEXT NOT NULL,
    "subtitleQuote" TEXT,
    "discourseType" TEXT NOT NULL DEFAULT 'Q&A',
    "detectedBy" JSONB NOT NULL DEFAULT '[]',
    "topics" JSONB NOT NULL DEFAULT '[]',
    "finalApScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "isVetoed" BOOLEAN NOT NULL DEFAULT false,
    "vetoReason" TEXT,
    "apScoreBreakdown" JSONB DEFAULT '{}',
    "llmAnalysis" JSONB DEFAULT '{}',
    "researchReferences" JSONB DEFAULT '{}',
    "status" "CandidateStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_clips_pkey" PRIMARY KEY ("id")
);

-- 12. Human Editorial Decisions & Feedback Flywheel
CREATE TABLE IF NOT EXISTS "editorial_decisions" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "editorId" TEXT NOT NULL DEFAULT 'default_editor',
    "decision" "EditorialAction" NOT NULL DEFAULT 'ACCEPT',
    "originalStartTime" DOUBLE PRECISION NOT NULL,
    "originalEndTime" DOUBLE PRECISION NOT NULL,
    "adjustedStartTime" DOUBLE PRECISION,
    "adjustedEndTime" DOUBLE PRECISION,
    "rejectionReason" TEXT,
    "notes" TEXT,
    "featureVectorSnapshot" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "editorial_decisions_pkey" PRIMARY KEY ("id")
);

-- 13. AP Rubric Rules Criteria
CREATE TABLE IF NOT EXISTS "rubric_criteria" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'QUALITY',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "minThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.70,
    "description" TEXT NOT NULL,
    "evaluationRule" TEXT NOT NULL,
    "isVetoTrigger" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rubric_criteria_pkey" PRIMARY KEY ("id")
);

-- ==========================================
-- 14. Performance Indexes & Vector Search
-- ==========================================
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_token_key" ON "auth_sessions"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "editor_profiles_userId_key" ON "editor_profiles"("userId");

CREATE INDEX IF NOT EXISTS "scene_cuts_sessionId_startTime_idx" ON "scene_cuts"("sessionId", "startTime");
CREATE INDEX IF NOT EXISTS "keyframes_sessionId_timestamp_idx" ON "keyframes"("sessionId", "timestamp");
CREATE INDEX IF NOT EXISTS "transcript_segments_sessionId_startTime_idx" ON "transcript_segments"("sessionId", "startTime");
CREATE INDEX IF NOT EXISTS "semantic_chunks_sessionId_startTime_idx" ON "semantic_chunks"("sessionId", "startTime");
CREATE INDEX IF NOT EXISTS "candidate_clips_sessionId_finalApScore_idx" ON "candidate_clips"("sessionId", "finalApScore");
CREATE INDEX IF NOT EXISTS "editorial_decisions_sessionId_decision_idx" ON "editorial_decisions"("sessionId", "decision");

-- HNSW Vector Index for Sub-10ms Cosine Similarity Search
CREATE INDEX IF NOT EXISTS "semantic_chunks_embedding_hnsw_idx" ON "semantic_chunks" USING hnsw (embedding vector_cosine_ops);

-- ==========================================
-- 15. Foreign Key Constraints (Cascade Rules)
-- ==========================================
DO $$ BEGIN
    ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "editor_profiles" ADD CONSTRAINT "editor_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "scene_cuts" ADD CONSTRAINT "scene_cuts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "keyframes" ADD CONSTRAINT "keyframes_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "semantic_chunks" ADD CONSTRAINT "semantic_chunks_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "candidate_clips" ADD CONSTRAINT "candidate_clips_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "candidate_clips" ADD CONSTRAINT "candidate_clips_discoveryRunId_fkey" FOREIGN KEY ("discoveryRunId") REFERENCES "discovery_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "editorial_decisions" ADD CONSTRAINT "editorial_decisions_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidate_clips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "editorial_decisions" ADD CONSTRAINT "editorial_decisions_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
