// programs/agentproof/src/state/mod.rs
pub mod agent_record;
pub mod task_proof;
pub mod witness_pool;

pub use agent_record::AgentRecord;
pub use task_proof::{TaskProof, task_type};
pub use witness_pool::{WitnessPool, WitnessRecord};
