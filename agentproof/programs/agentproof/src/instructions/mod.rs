// programs/agentproof/src/instructions/mod.rs
pub mod create_task;
pub mod freeze_agent;
pub mod initialize_witness_pool;
pub mod register_agent;
pub mod register_witness;
pub mod submit_proof;
pub mod settle_task;
pub mod witness_sign;

pub use create_task::CreateTask;
pub use freeze_agent::FreezeAgent;
pub use initialize_witness_pool::InitializeWitnessPool;
pub use register_agent::RegisterAgent;
pub use register_witness::RegisterWitness;
pub use submit_proof::{SubmitProof, SubmitProofParams};
pub use witness_sign::WitnessSign;
