use anchor_lang::prelude::*;

declare_id!("FaCejPTn2Cf6LRZiiRRVrQHn5tuPFCxvgDAGR8Z8q5ac");

#[program]
pub mod basic {
    use super::*;

    pub fn greet(_ctx: Context<Initialize>) -> Result<()> {
        msg!("GM!");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
