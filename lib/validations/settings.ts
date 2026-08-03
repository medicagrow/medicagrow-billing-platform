import { z } from "zod";
import { EhrSource, Role } from "@/lib/generated/prisma/enums";
import { emailSchema, passwordSchema } from "@/lib/validations/common";
import {
  alphanumericSchema,
  einSchema,
  npiSchema,
  optionalEmailSchema,
  optionalPhoneSchema,
  optionalTextSchema,
  requiredNpiSchema,
  stateSchema,
  taxonomySchema,
  zipSchema,
} from "@/lib/validations/identifiers";

export const practiceSchema = z.object({
  name: z.string().trim().min(2, "Practice name is required").max(150),
  ehrSource: z.enum(EhrSource),
  isActive: z.boolean().default(true),
});

/** Every profile field is optional and patched tab by tab. */
export const updatePracticeSchema = z
  .object({
    name: z.string().trim().min(2, "Practice name is required").max(150),
    ehrSource: z.enum(EhrSource),
    isActive: z.boolean(),

    taxId: einSchema,
    npi: npiSchema,
    taxonomy: taxonomySchema,
    medicarePtan: alphanumericSchema(10, "Medicare PTAN"),
    medicaidProviderNumber: alphanumericSchema(15, "Medicaid provider number"),

    billingAddressLine1: optionalTextSchema(150),
    billingAddressLine2: optionalTextSchema(150),
    billingCity: optionalTextSchema(80),
    billingState: stateSchema,
    billingZip: zipSchema,

    contactPersonName: optionalTextSchema(120),
    contactPhone: optionalPhoneSchema,
    contactFax: optionalPhoneSchema,
    contactEmail: optionalEmailSchema,

    /** Empty string clears the assignment. The route checks the role. */
    primaryPmId: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => (value ?? "").trim() || null)
      .optional(),
  })
  .partial();

export const practiceProviderSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  npi: requiredNpiSchema,
  licenseNumber: alphanumericSchema(30, "License number"),
  licenseState: stateSchema,
  taxonomy: taxonomySchema,
  isActive: z.boolean().default(true),
});

export const updatePracticeProviderSchema = practiceProviderSchema.partial();

const practiceIdsSchema = z.array(z.string().min(1)).default([]);

export const createUserSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(120),
    email: emailSchema,
    password: passwordSchema,
    role: z.enum(Role),
    practiceIds: practiceIdsSchema,
    isActive: z.boolean().default(true),
  })
  .transform((data) => ({
    ...data,
    // Owners reach every practice implicitly, so explicit assignments are noise.
    practiceIds: data.role === Role.OWNER ? [] : data.practiceIds,
  }));

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(120).optional(),
    email: emailSchema.optional(),
    /** Omitted or blank means "leave the existing password alone". */
    password: passwordSchema.optional(),
    role: z.enum(Role).optional(),
    practiceIds: practiceIdsSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .transform((data) => ({
    ...data,
    practiceIds:
      data.role === Role.OWNER ? [] : data.practiceIds,
  }));
