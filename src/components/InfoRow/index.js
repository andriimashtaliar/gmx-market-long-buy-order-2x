import React from 'react'

import './InfoRow.css'

export const InfoRow = ({label, value}) => {
    return (
        <div className='info-container'>
            <div className='info-container-label'>{label}</div>
            <div className='info-container-value'>{value}</div>
        </div>
    )
}