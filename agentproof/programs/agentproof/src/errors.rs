// programs/agentproof/src/errors.rs
use anchor_lang::prelude::*;

#[error_code]
pub enum AgentProofError {
    #[msg("Agent is frozen and cannot perform actions")]
    AgentFrozen,

    #[msg("Agent is already frozen")]
    AgentAlreadyFrozen,

    #[msg("Insufficient stake amount (minimum 0.1 SOL)")]
    InsufficientStake,

    #[msg("Proof has already been settled")]
    ProofAlreadySettled,

    #[msg("Witness is not authorized for this task")]
    UnauthorizedWitness,

    #[msg("Witness has already signed this proof")]
    AlreadySigned,

    #[msg("Unauthorized freeze authority")]
    UnauthorizedFreezeAuthority,

    #[msg("Witness pool is full")]
    WitnessPoolFull,

    #[msg("Task proof not found")]
    ProofNotFound,

    #[msg("Invalid task type")]
    InvalidTaskType,

    #[msg("Task not found")]
    TaskNotFound,

    #[msg("Task has already been settled")]
    TaskAlreadySettled,

    #[msg("Task deadline has passed")]
    TaskExpired,

    #[msg("Task deadline has not passed yet")]
    TaskNotExpired,

    #[msg("Capability hash does not match agent record")]
    CapabilityMismatch,

    #[msg("Amount must be greater than zero")]
    InvalidAmount,
}
