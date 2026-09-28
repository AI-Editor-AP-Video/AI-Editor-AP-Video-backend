import { prisma } from "../../infrastructure/db/prisma.js";
import { RUBRIC_DEFAULT_CRITERIA } from "../../config/constants.js";
import { AppError } from "../../middleware/errorHandler.js";

export class RubricService {
  async getRubricCriteria() {
    let criteria = await prisma.rubricCriterion.findMany({
      orderBy: { weight: "desc" },
    });

    // Seed defaults if empty
    if (criteria.length === 0) {
      for (const item of RUBRIC_DEFAULT_CRITERIA) {
        await prisma.rubricCriterion.upsert({
          where: { id: item.id },
          create: item,
          update: {},
        });
      }
      criteria = await prisma.rubricCriterion.findMany({
        orderBy: { weight: "desc" },
      });
    }

    return criteria;
  }

  async updateRubricCriterion(
    id: string,
    updates: {
      weight?: number;
      minThreshold?: number;
      evaluationRule?: string;
      isVetoTrigger?: boolean;
    }
  ) {
    const existing = await prisma.rubricCriterion.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(`Rubric criterion '${id}' not found`, 404);
    }

    return prisma.rubricCriterion.update({
      where: { id },
      data: updates,
    });
  }
}

export const rubricService = new RubricService();
