import { createContext } from 'react';

/**
 * 按更新频率拆分 Context
 * 避免单一 Context 导致的高频全局重渲染
 */

// 1. 认证层 (AuthContext): 登录后基本不变化
export const AuthContext = createContext(null);

// 2. 资产结构层 (AssetsStructureContext): 仅在资产增删、同步完成时变化
export const AssetsStructureContext = createContext(null);

// 3. 实时数据层 (QuotesContext): 高频更新，行情与分时图数据
export const QuotesContext = createContext(null);

// 4. UI 交互层 (UIContext): 独立管理 Tab、弹窗等状态
export const UIContext = createContext(null);
