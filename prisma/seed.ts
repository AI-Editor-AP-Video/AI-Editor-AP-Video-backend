import { PrismaClient } from "@prisma/client";
import { RUBRIC_DEFAULT_CRITERIA } from "../src/config/constants.js";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting AP Editorial database seed...");

  // 1. Seed Rubric Criteria
  console.log("  → Seeding 7 AP Rubric Criteria...");
  for (const crit of RUBRIC_DEFAULT_CRITERIA) {
    await prisma.rubricCriterion.upsert({
      where: { id: crit.id },
      create: {
        id: crit.id,
        name: crit.name,
        category: crit.category,
        weight: crit.weight,
        minThreshold: crit.minThreshold,
        description: crit.description,
        evaluationRule: crit.evaluationRule,
        isVetoTrigger: crit.isVetoTrigger,
      },
      update: {},
    });
  }

  // 2. Seed Default Editor User
  console.log("  → Seeding Default Editor User...");
  const editor = await prisma.user.upsert({
    where: { email: "editor@acharyaprashant.org" },
    create: {
      email: "editor@acharyaprashant.org",
      name: "Aman Sharma",
      role: "EDITOR",
      emailVerified: true,
      profile: {
        create: {
          preferredLanguage: "hi",
          autoSnapToShots: true,
          minScoreFilter: 0.70,
          themePreference: "dark",
        },
      },
    },
    update: {},
  });

  // 3. Seed Video Sessions
  console.log("  → Seeding Video Sessions...");

  // Session 1: Gita Ch.2 (Discovery Done with 14 Candidates)
  const sessionGita = await prisma.videoSession.upsert({
    where: { id: "sess_gita_02" },
    create: {
      id: "sess_gita_02",
      title: "Bhagavad Gita Chapter 2: Sankhya Yoga & Real Karma",
      description: "Deep commentary on Gita 2.47, Nishkama Karma, and overcoming existential fear through Vedantic enquiry.",
      durationSeconds: 7420,
      extractionStatus: "LOCKED_AND_INDEXED",
      extractionProgress: 100,
      seriesCategory: "Bhagavad Gita",
      masterVideoS3Key: "videos/gita_ch2_full_discourse.mp4",
      proxyVideoS3Key: "proxies/gita_ch2_480p.mp4",
      audioTrackS3Key: "audio/gita_ch2_16k.wav",
    },
    update: {},
  });

  // Session 2: Mandukya Upanishad (Discovery Done with 18 Candidates)
  const sessionUpanishad = await prisma.videoSession.upsert({
    where: { id: "sess_upanishad_01" },
    create: {
      id: "sess_upanishad_01",
      title: "Mandukya Upanishad: The Four States of Consciousness",
      description: "Exploration of Jagrat, Swapna, Sushupti, and Turiya.",
      durationSeconds: 8100,
      extractionStatus: "LOCKED_AND_INDEXED",
      extractionProgress: 100,
      seriesCategory: "Upanishads",
      masterVideoS3Key: "videos/mandukya_upanishad_01.mp4",
    },
    update: {},
  });

  // Session 3: Katha Upanishad (Data Extracted & Ready for AI Discovery)
  await prisma.videoSession.upsert({
    where: { id: "sess_upanishad_katha" },
    create: {
      id: "sess_upanishad_katha",
      title: "Katha Upanishad: The Mystery of Nachiketa & Overcoming Death",
      description: "Dialogue between Nachiketa and Yama on the nature of Self.",
      durationSeconds: 7800,
      extractionStatus: "LOCKED_AND_INDEXED",
      extractionProgress: 100,
      seriesCategory: "Upanishads",
      masterVideoS3Key: "videos/katha_upanishad_nachiketa.mp4",
    },
    update: {},
  });

  // Session 4: Sant Kabir (Extracting Data in progress)
  await prisma.videoSession.upsert({
    where: { id: "sess_kabir_03" },
    create: {
      id: "sess_kabir_03",
      title: "Sant Kabir Dohas: Illusion of Maya & True Guru",
      description: "Commentary on Kabir's revolutionary verses on mind illusion.",
      durationSeconds: 6840,
      extractionStatus: "EXTRACTING_MEDIA",
      extractionProgress: 28,
      seriesCategory: "Sant Kabir",
      masterVideoS3Key: "videos/kabir_dohas_session_03.mp4",
    },
    update: {},
  });

  // 4. Seed Transcript Segments for Gita Ch.2
  console.log("  → Seeding Transcript Segments...");
  const transcriptData = [
    {
      id: "tr_001",
      sessionId: "sess_gita_02",
      segmentIndex: 1,
      startTime: 120,
      endTime: 155,
      speakerName: "Questioner (Anil)",
      speakerId: 1,
      textHindi: "आचार्य जी, गीता में कृष्ण कहते हैं 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन'। लेकिन अगर फल की इच्छा न हो तो काम करने की प्रेरणा कहाँ से आएगी?",
      textEnglish: "Acharya Ji, Krishna says in the Gita: 'Karmanye vadikaraste ma phaleshu kadachana'. But if there is no desire for the fruit, where will the motivation to act come from?",
      sentiment: "URGENT",
      energyLevel: 0.65,
    },
    {
      id: "tr_002",
      sessionId: "sess_gita_02",
      segmentIndex: 2,
      startTime: 156,
      endTime: 245,
      speakerName: "Acharya Prashant",
      speakerId: 0,
      textHindi: "ध्यान से समझो। जब तुम फल के लिए काम करते हो, तो तुम्हारा ध्यान काम पर नहीं, भविष्य के उस काल्पनिक सुख पर होता है। फल की इच्छा ही आलस्य और भय की जननी है।",
      textEnglish: "Understand carefully. When you act solely for the fruit, your attention is not on the action, but on an imaginary future pleasure. The desire for the fruit is the very mother of fear and procrastination.",
      sentiment: "DIRECT",
      energyLevel: 0.88,
    },
    {
      id: "tr_003",
      sessionId: "sess_gita_02",
      segmentIndex: 3,
      startTime: 246,
      endTime: 330,
      speakerName: "Acharya Prashant",
      speakerId: 0,
      textHindi: "कर्म का अधिकार तुम्हारा है, क्योंकि वर्तमान तुम्हारे पास है। फल का अधिकार इसलिए नहीं क्योंकि फल काल और परिस्थितियों के अधीन है। जब कर्म ही मुक्ति बन जाए, तो किसी फल की आवश्यकता नहीं रहती।",
      textEnglish: "The right to action belongs to you because you possess the present moment. The fruit does not belong to you because outcomes depend on time and vast external variables. When the right action itself becomes liberation, no external reward is required.",
      sentiment: "CONTEMPLATIVE",
      energyLevel: 0.94,
    },
  ];

  for (const tr of transcriptData) {
    await prisma.transcriptSegment.upsert({
      where: { id: tr.id },
      create: tr,
      update: {},
    });
  }

  // 5. Seed Candidate Clips for Gita Ch.2
  console.log("  → Seeding Candidate Clips...");
  await prisma.candidateClip.upsert({
    where: { id: "cand_gita_01" },
    create: {
      id: "cand_gita_01",
      sessionId: "sess_gita_02",
      rank: 1,
      startTime: 156,
      endTime: 330,
      durationSeconds: 174,
      headline: "Why Motivation Fails: The Real Meaning of 'Karmanye Vadhikaraste'",
      subtitleQuote: "“When you act for results, your focus is on fantasy, not craftsmanship.”",
      discourseType: "Q&A",
      detectedBy: ["Qwen3-Embedding-0.6B", "faster-whisper", "PySceneDetect"],
      topics: ["Bhagavad Gita", "Nishkama Karma", "Overcoming Procrastination", "Self-Inquiry"],
      finalApScore: 0.94,
      isVetoed: false,
      apScoreBreakdown: {
        mission_relevance: 0.98,
        meaning_preservation: 0.99,
        content_quality: 0.95,
        audience_relevance: 0.92,
        novelty_score: 0.88,
        ethical_editorial_compliance: 1.0,
      },
      llmAnalysis: {
        candidate_summary: "Acharya Prashant dismantles modern 'outcome-based' motivation culture using Gita 2.47, explaining why anticipating rewards causes anxiety and how total immersion in right action brings effortless mastery.",
        qa_analysis: {
          is_qa: true,
          question: "If we don't care about the fruit or result, where will the motivation to work come from?",
          core_answer: "The fruit is in an imaginary future; action is in the living present. Desire for the fruit is the mother of fear and procrastination.",
        },
      },
      status: "PENDING",
    },
    update: {},
  });

  // 6. Seed Editorial Decisions
  console.log("  → Seeding Editorial Decisions Audit Log...");
  await prisma.editorialDecision.create({
    data: {
      candidateId: "cand_gita_01",
      sessionId: "sess_gita_02",
      editorId: editor.id,
      decision: "ACCEPT",
      originalStartTime: 156,
      originalEndTime: 330,
      notes: "Flawless philosophical synthesis of Gita 2.47. Retains complete context from question to conclusion.",
    },
  });

  console.log("✅ AP Editorial database seeding completed successfully.");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
